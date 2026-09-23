import assert from "node:assert/strict"
import { once } from "node:events"
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises"
import { connect, createServer } from "node:net"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import ts from "typescript"

import { readViteSnapshots } from "./snapshots"

const root = resolve(import.meta.dir, "../..")
const fixture = join(root, "tests/fixtures")
const workspace = await mkdtemp(join(tmpdir(), "nuxt-multi-app-"))
const portable = await mkdtemp(join(tmpdir(), "nuxt-multi-app-output-"))
const nuxtVersion = process.argv[2] ?? "4.5.2"
const hosts = { root: "landing.localhost", web: "foo.tenant.localhost" }

async function run(command: string[], cwd: string, env = process.env) {
  const child = Bun.spawn(command, { cwd, env, stdout: "inherit", stderr: "inherit" })
  if ((await child.exited) !== 0) throw new Error(`Command failed: ${command.join(" ")}`)
}

async function unusedPort() {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No TCP port assigned")
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  return address.port
}

async function waitUntil(
  child: ReturnType<typeof Bun.spawn>,
  check: () => Promise<boolean>,
  description: string,
  timeout = 90_000,
) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${description}: server exited early`)
    if (await check().catch(() => false)) return
    await Bun.sleep(100)
  }
  throw new Error(`${description}: timed out`)
}

async function waitUntilReady(origin: string, child: ReturnType<typeof Bun.spawn>) {
  await waitUntil(
    child,
    async () => (await fetch(`${origin}/__nuxt_multi_app/ready`)).ok,
    "Nuxt applications did not become ready",
  )
}

async function request(origin: string, path: string, host: string, init: RequestInit = {}) {
  return fetch(`${origin}${path}`, {
    ...init,
    headers: { ...Object.fromEntries(new Headers(init.headers)), host },
  })
}

async function assertResponse(
  origin: string,
  path: string,
  host: string,
  expectedStatus: number,
  expectedText: string | string[],
) {
  const response = await request(origin, path, host)
  const body = await response.text()
  const expected = Array.isArray(expectedText) ? expectedText : [expectedText]
  if (response.status !== expectedStatus || expected.some((part) => !body.includes(part))) {
    throw new Error(
      `${host}${path}: expected ${expectedStatus} containing ${expected.join(", ")}, got ${response.status} ${body}`,
    )
  }
  return response
}

async function assertWebSocket(port: number) {
  const socket = connect(port, "127.0.0.1")
  const result = new Promise<void>((resolve, reject) => {
    let response = ""
    const timer = setTimeout(() => reject(new Error("WebSocket upgrade timed out")), 5_000)
    socket.on("connect", () => {
      socket.write(
        [
          "GET /api/socket HTTP/1.1",
          `Host: ${hosts.web}`,
          "Connection: Upgrade",
          "Upgrade: websocket",
          "Sec-WebSocket-Version: 13",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "",
          "",
        ].join("\r\n"),
      )
    })
    socket.on("data", (chunk) => {
      response += chunk.toString()
      if (!response.includes("\r\n\r\n")) return
      clearTimeout(timer)
      if (!response.startsWith("HTTP/1.1 101")) {
        reject(new Error(`WebSocket upgrade failed: ${response}`))
      } else resolve()
    })
    socket.on("error", reject)
  })
  try {
    await result
  } finally {
    socket.destroy()
  }
}

async function runBrowser(workspace: string, port: number, mode: "development" | "production") {
  await run(["bun", "run", "playwright", "test", "tests/nuxt/browser.playwright.ts"], root, {
    ...process.env,
    NUXT_MULTI_APP_TEST_URL: `http://${hosts.root}:${port}`,
    NUXT_MULTI_APP_TEST_PORT: String(port),
    NUXT_MULTI_APP_TEST_MODE: mode,
    NUXT_MULTI_APP_TEST_WORKSPACE: workspace,
    NUXT_MULTI_APP_TEST_OUTPUT: join(workspace, "contexts.jsonl"),
  })
}

async function assertBackpressure(origin: string) {
  const result = await request(origin, "/api/backpressure", hosts.root).then((response) =>
    response.json(),
  )
  assert(
    result.producedAtFirstRead < 64,
    "Dispatch consumed the complete stream before its caller requested it",
  )
  assert.equal(result.producedAfterComplete, 64)
}

async function assertProductionShutdown(origin: string, server: ReturnType<typeof Bun.spawn>) {
  const active = request(origin, "/api/dispatch/slow", hosts.root)
    .then((response) => response.text())
    .catch(() => undefined)
  await waitUntil(
    server,
    async () =>
      request(origin, "/api/dispatch/state", hosts.web)
        .then((response) => response.json())
        .then((state) => state.slowStarted > 0),
    "Active dispatch did not reach its owner",
    5_000,
  )
  const probe = request(origin, "/api/shutdown-probe", hosts.root).then((response) =>
    response.json(),
  )
  await Bun.sleep(100)
  server.kill("SIGTERM")
  await Bun.sleep(200)
  assert.equal(server.exitCode, null, "Production server did not drain an active dispatch")
  assert.deepEqual(await probe, { dispatchStatus: 503 })
  assert.equal(await server.exited, 0)
  await active
}

async function checkServer(
  command: string[],
  cwd: string,
  mode: "development" | "production" | "portable",
) {
  const port = await unusedPort()
  const origin = `http://127.0.0.1:${port}`
  const resolverOutput = join(workspace, `resolver-${mode}.log`)
  const childStartupBarrier = join(workspace, `child-startup-${mode}`)
  const childStartupWaiting = `${childStartupBarrier}.waiting`
  const childStartupRelease = `${childStartupBarrier}.release`
  const runtimeBase =
    mode === "production" ? "runtime-a.localhost" : mode === "portable" ? "runtime-b.localhost" : ""
  await Promise.all(
    [resolverOutput, childStartupWaiting, childStartupRelease].map((path) =>
      rm(path, { force: true }),
    ),
  )
  const env = {
    ...process.env,
    HOST: "127.0.0.1",
    PORT: String(port),
    NUXT_TELEMETRY_DISABLED: "1",
    NUXT_MULTI_APP_TEST: "1",
    NUXT_MULTI_APP_TEST_OUTPUT: join(workspace, "contexts.jsonl"),
    NUXT_MULTI_APP_TEST_RESOLVER_OUTPUT: resolverOutput,
    NUXT_MULTI_APP_TEST_BASE: runtimeBase,
    NUXT_MULTI_APP_TEST_CHILD_STARTUP_BARRIER: mode === "development" ? childStartupBarrier : "",
  }
  const child = Bun.spawn(command, {
    cwd,
    env,
    stdout: "inherit",
    stderr: "inherit",
    // Own the CLI's fork as well, so a failed browser test cannot leave watchers behind.
    detached: process.platform !== "win32",
  })
  let stopped = false
  try {
    if (mode === "development") {
      await waitUntil(
        child,
        () => Bun.file(childStartupWaiting).exists(),
        "Mounted child did not reach its startup barrier",
      )
      await waitUntil(
        child,
        async () => (await request(origin, "/", hosts.root)).status === 200,
        "Listener owner did not become ready",
      )
      const starting = await request(origin, "/api/dispatch", hosts.root)
      assert.equal(starting.status, 503, "Dispatch did not expose a starting backend as 503")
      await writeFile(childStartupRelease, "")
    }
    await waitUntilReady(origin, child)
    assert.deepEqual((await readFile(resolverOutput, "utf8")).trim().split("\n"), [
      "import",
      "initialize",
    ])
    if (runtimeBase) {
      const otherBase = mode === "production" ? "runtime-b.localhost" : "runtime-a.localhost"
      await assertResponse(origin, "/", runtimeBase, 200, "ROOT_HMR_0")
      await assertResponse(origin, "/", otherBase, 404, "No Nuxt application")
    }
    await assertResponse(origin, "/", hosts.root, 200, "ROOT_HMR_0")
    await assertResponse(origin, "/", hosts.web, 200, [
      "WEB_HMR_0",
      "web-auto-import",
      "child-component",
      "ISOLATED_COMPONENT",
    ])
    for (const path of ["/api/owner", "/api/dispatch"]) {
      const response = await request(origin, path, hosts.root)
      assert.equal(response.status, 200)
      assert.equal((await response.json()).app, "web")
    }
    const unmatched = await assertResponse(
      origin,
      "/",
      "unknown.localhost",
      404,
      "No Nuxt application",
    )
    assert.equal(unmatched.headers.get("x-nuxt-multi-app-test-state"), "unmatched")
    await assertWebSocket(port)
    await assertBackpressure(origin)
    if (mode !== "portable") await runBrowser(workspace, port, mode)

    if (mode === "production") {
      await assertProductionShutdown(origin, child)
      stopped = true
    } else {
      const snapshots = mode === "development" ? await readViteSnapshots(workspace) : []
      child.kill(mode === "development" ? "SIGINT" : "SIGTERM")
      assert.equal(await child.exited, 0)
      stopped = true
      await assertIpcStopped(snapshots)
    }
  } finally {
    if (mode === "development") await writeFile(childStartupRelease, "").catch(() => undefined)
    if (!stopped && child.exitCode === null) {
      if (process.platform === "win32") child.kill("SIGKILL")
      else process.kill(-child.pid, "SIGKILL")
      await child.exited
    }
  }
}

async function assertRestartableDev(cwd: string) {
  const port = await unusedPort()
  const origin = `http://127.0.0.1:${port}`
  const child = Bun.spawn(
    ["node", "node_modules/nuxt/bin/nuxt.mjs", "dev", "root", "--host", "127.0.0.1"],
    {
      cwd,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
        NUXT_TELEMETRY_DISABLED: "1",
      },
      stdout: "inherit",
      stderr: "inherit",
    },
  )
  try {
    await waitUntilReady(origin, child)
  } finally {
    const snapshots = await readViteSnapshots(workspace)
    child.kill("SIGINT")
    assert.equal(await child.exited, 0)
    await assertIpcStopped(snapshots)
  }
}

async function assertIpcStopped(snapshots: { socketPath: string }[]) {
  // Listhen exits directly on SIGINT, so stale socket files may remain after all listeners die.
  // Full Nuxt restart must also unlink them; the browser scenario checks that stronger contract.
  for (const { socketPath } of snapshots) {
    const socket = connect(socketPath)
    try {
      await assert.rejects(
        once(socket, "connect"),
        (error: NodeJS.ErrnoException) => error.code === "ENOENT" || error.code === "ECONNREFUSED",
      )
    } finally {
      socket.destroy()
    }
  }
}

/** Compile every published declaration file, so none can reference an unpublished source module. */
async function assertPackageDeclarations() {
  const packageDir = join(workspace, "node_modules/nuxt-multi-app/dist")
  const files = (await readdir(packageDir, { recursive: true }))
    .filter((file) => /\.d\.m?ts$/.test(file))
    .map((file) => join(packageDir, file))
  const program = ts.createProgram({
    rootNames: files,
    options: {
      noEmit: true,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ESNext,
      types: ["node"],
    },
  })
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .filter((diagnostic) => diagnostic.file?.fileName.startsWith(packageDir))
      .map(
        (diagnostic) =>
          `${diagnostic.file!.fileName}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`,
      ),
    [],
  )
}

async function assertTypeProfiles() {
  const probe = join(workspace, "web/app/type-profile-probe.ts")
  await writeFile(
    probe,
    'import { useNuxtApp } from "#app"\nconst marker: "mounted" = useNuxtApp().$mountedOnly\nvoid marker\n',
  )
  try {
    const standalone = diagnosticsFor(probe, join(workspace, "web/.nuxt/tsconfig.app.json"))
    const mounted = diagnosticsFor(
      probe,
      join(workspace, "root/.nuxt/multi-app/apps/web/tsconfig.app.json"),
    )
    assert(
      standalone.length > 0,
      "Standalone profile unexpectedly received the mount-only plugin type",
    )
    assert.deepEqual(
      mounted.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
      [],
    )
  } finally {
    await rm(probe)
  }
}

async function assertProjectModuleTypeProfile() {
  const config = join(workspace, "root/.nuxt/tsconfig.node.json")
  for (const name of ["resolver.ts", "state-handler.ts"]) {
    const diagnostics = diagnosticsFor(join(workspace, "root", name), config)
    assert.deepEqual(
      diagnostics.map((diagnostic) =>
        ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
      ),
      [],
    )
  }

  const appIdTypeTest = join(workspace, "root/server/app-ids.type-test.ts")
  const appIdDiagnostics = diagnosticsFor(
    appIdTypeTest,
    join(workspace, "root/.nuxt/tsconfig.server.json"),
  )
  assert.deepEqual(
    appIdDiagnostics.map((diagnostic) =>
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    ),
    [],
  )

  const diagnosticProbe = join(workspace, "root/server/app-id-diagnostic.type-test.ts")
  await writeFile(
    diagnosticProbe,
    'import type { NuxtMultiAppRequestContext } from "nuxt-multi-app/runtime"\ndeclare const context: NuxtMultiAppRequestContext\ncontext.dispatch("website", new Request("http://internal"))\n',
  )
  try {
    const diagnostics = diagnosticsFor(
      diagnosticProbe,
      join(workspace, "root/.nuxt/tsconfig.server.json"),
    )
    assert.equal(diagnostics.length, 1)
    assert.match(
      ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, "\n"),
      /parameter of type '"root" \| "web"'/,
    )
  } finally {
    await rm(diagnosticProbe)
  }
}

async function assertResolverStartupFailure(command: string[], cwd: string) {
  const child = Bun.spawn(command, {
    cwd,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(await unusedPort()),
      NUXT_TELEMETRY_DISABLED: "1",
      NUXT_MULTI_APP_TEST_RESOLVER_FAIL: "1",
    },
    stdout: "ignore",
    stderr: "pipe",
  })
  const stderr = new Response(child.stderr).text()
  const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000)
  const exitCode = await child.exited
  clearTimeout(timeout)
  assert.notEqual(exitCode, 0, "Server accepted a failing resolver factory")
  assert.match(await stderr, /resolver in routing rule 2 initialization failed/)
}

async function assertStaticProductionRouting(cwd: string) {
  const manifestPath = join(cwd, "output/server/manifest.json")
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"))
  manifest.routing = manifest.routing.filter((rule: object) => !("resolver" in rule))
  manifest.stateHandler = null
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  const port = await unusedPort()
  const origin = `http://127.0.0.1:${port}`
  const child = Bun.spawn(["node", "output/server/index.mjs"], {
    cwd,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdout: "pipe",
    stderr: "inherit",
  })
  const stdout = new Response(child.stdout).text()
  try {
    await waitUntilReady(origin, child)
    await assertResponse(origin, "/", hosts.root, 200, "ROOT_HMR_0")
    await assertResponse(origin, "/", hosts.web, 200, "WEB_HMR_0")
    const pathResponse = await request(origin, "/api/owner", hosts.root)
    assert.equal(pathResponse.status, 200)
    assert.equal((await pathResponse.json()).app, "web")
    const unmatched = await assertResponse(
      origin,
      "/",
      "unknown.localhost",
      404,
      "No Nuxt application",
    )
    assert.equal(unmatched.headers.get("x-nuxt-multi-app-test-state"), null)
  } finally {
    child.kill("SIGTERM")
    assert.equal(await child.exited, 0)
  }
  assert.match(await stdout, /\[nuxt-multi-app] routing: 3 ordered rules/)
}

async function assertNuxtPreview(cwd: string) {
  const port = await unusedPort()
  const origin = `http://127.0.0.1:${port}`
  const child = Bun.spawn(
    ["node", "node_modules/nuxt/bin/nuxt.mjs", "preview", "root", "--port", String(port)],
    {
      cwd,
      env: { ...process.env, HOST: "127.0.0.1", NUXT_TELEMETRY_DISABLED: "1" },
      stdout: "inherit",
      stderr: "inherit",
      detached: process.platform !== "win32",
    },
  )
  try {
    await waitUntilReady(origin, child)
    await assertResponse(origin, "/", hosts.root, 200, "ROOT_HMR_0")
  } finally {
    if (child.exitCode === null) {
      if (process.platform === "win32") child.kill("SIGKILL")
      else process.kill(-child.pid, "SIGTERM")
      await child.exited
    }
  }
}

function diagnosticsFor(file: string, configPath: string) {
  const config = ts.getParsedCommandLineOfConfigFile(
    configPath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic(diagnostic) {
        throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"))
      },
    },
  )
  if (!config) throw new Error(`Unable to parse ${configPath}`)
  assert(config.fileNames.includes(file), `${configPath} does not include the application probe`)
  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options })
  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === file)
}

try {
  const archive = join(workspace, "nuxt-multi-app.tgz")
  await run(["bun", "pm", "pack", "--ignore-scripts", "--quiet", "--filename", archive], root)
  await cp(fixture, workspace, { recursive: true })
  await writeFile(
    join(workspace, "package.json"),
    JSON.stringify(
      {
        name: "nuxt-multi-app-consumer",
        private: true,
        type: "module",
        dependencies: {
          nuxt: nuxtVersion,
          "nuxt-multi-app": `file:${archive}`,
        },
        // The package declares `@types/node` as an optional peer, so a consumer supplies the Node
        // typings its own application sources rely on, matching the Node major the tests run on.
        devDependencies: {
          "@types/node": "^24",
          typescript: "5.9.3",
          "vue-tsc": "3.3.11",
        },
      },
      null,
      2,
    ),
  )
  await run(["bun", "install", "--ignore-scripts"], workspace)
  await run(["bun", "run", "nuxt", "prepare", "web"], workspace)
  await run(["bun", "run", "nuxt", "prepare", "root"], workspace)
  const typecheckConfig = join(workspace, "root/.nuxt/tsconfig.multi-app.json")
  const typecheckSolution = JSON.parse(await readFile(typecheckConfig, "utf8"))
  assert.deepEqual(
    typecheckSolution.references.map(({ path }: { path: string }) => path),
    [
      "./tsconfig.app.json",
      "./tsconfig.server.json",
      "./tsconfig.shared.json",
      "./tsconfig.node.json",
      "./multi-app/apps/web/tsconfig.app.json",
      "./multi-app/apps/web/tsconfig.server.json",
      "./multi-app/apps/web/tsconfig.shared.json",
      "./multi-app/apps/web/tsconfig.node.json",
    ],
  )
  await run(["bun", "run", "vue-tsc", "-b", "--noEmit", typecheckConfig], workspace)
  await assertPackageDeclarations()
  await assertTypeProfiles()
  await assertProjectModuleTypeProfile()
  await assertResolverStartupFailure(
    ["node", "node_modules/nuxt/bin/nuxt.mjs", "dev", "root", "--host", "127.0.0.1"],
    workspace,
  )
  await checkServer(
    ["node", "node_modules/nuxt/bin/nuxt.mjs", "dev", "root", "--host", "127.0.0.1"],
    workspace,
    "development",
  )
  // Restore HMR/reload edits only after the dev process has stopped, before the fresh start and build.
  await cp(fixture, workspace, { recursive: true })
  for (const app of ["root", "web"]) {
    await rm(join(workspace, app, "app/plugins/overlap-probe.ts"))
  }
  await assertRestartableDev(workspace)
  await run(["bun", "run", "nuxt", "build", "root"], workspace)
  const manifest = JSON.parse(
    await readFile(join(workspace, "root/.output/server/manifest.json"), "utf8"),
  )
  assert.deepEqual(
    manifest.apps.map((app: { id: string; entry: string }) => [app.id, app.entry]),
    [
      ["root", "../apps/root/server/index.mjs"],
      ["web", "../apps/web/server/index.mjs"],
    ],
  )
  const rootEntry = await readFile(
    join(workspace, "root/.output/apps/root/server/index.mjs"),
    "utf8",
  )
  assert.match(rootEntry, /import "\.\/late-nitro-output\.mjs"/)
  const productionEntry = await readFile(join(workspace, "root/.output/server/index.mjs"), "utf8")
  assert.doesNotMatch(productionEntry, /late-nitro-output/)
  const nitro = JSON.parse(await readFile(join(workspace, "root/.output/nitro.json"), "utf8"))
  assert.equal(nitro.commands.preview, "node ./server/index.mjs")
  await assertNuxtPreview(workspace)
  await checkServer(["node", "root/.output/server/index.mjs"], workspace, "production")
  await cp(join(workspace, "root/.output"), join(portable, "output"), { recursive: true })
  await checkServer(["node", "output/server/index.mjs"], portable, "portable")
  await assertResolverStartupFailure(["node", "output/server/index.mjs"], portable)
  await assertStaticProductionRouting(portable)
} finally {
  await rm(workspace, { recursive: true, force: true })
  await rm(portable, { recursive: true, force: true })
}
