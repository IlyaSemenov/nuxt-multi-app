import { afterAll, describe, expect, it } from "bun:test"
import { cp, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { pathToFileURL } from "node:url"

import { build, copyPublicAssets, createNitro, prepare } from "nitropack"
import type { Nitro, NitroConfig } from "nitropack/types"

import { checkNitroExternalVersions } from "./external-versions"

const workspaces: string[] = []
const BUILD_TIMEOUT = 60_000

afterAll(async () => {
  await Promise.all(workspaces.map((dir) => rm(dir, { recursive: true, force: true })))
})

async function write(path: string, content: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

/** Install a package directly into a `node_modules` directory, as a package manager would. */
async function installPackage(
  modules: string,
  name: string,
  version: string,
  files: Record<string, string>,
  manifest: Record<string, unknown> = { type: "module", exports: "./index.js" },
) {
  const dir = join(modules, name)
  await write(join(dir, "package.json"), JSON.stringify({ name, version, ...manifest }))
  for (const [file, content] of Object.entries(files)) await write(join(dir, file), content)
}

function esm(version: string, extra = "") {
  return { "index.js": `export const version = ${JSON.stringify(version)}\n${extra}` }
}

/**
 * Packages that the application and the composition import in different versions, including
 * imports that tree shaking removes from the composition.
 */
const CONFLICTING = [
  "@probe/scoped",
  "cjs-probe",
  "dead-probe",
  "dual-probe",
  "dynamic-probe",
  "explicit-probe",
  "reexport-probe",
  "require-probe",
  "side-probe",
  "unused-probe",
  "unused-reexport-probe",
  "version-probe",
  "virtual-probe",
  "workspace-probe",
]

/** Install one copy of every probe package in a version, under a `node_modules` directory. */
async function installProbes(modules: string, version: string) {
  for (const name of [
    "version-probe",
    "dynamic-probe",
    "explicit-probe",
    "reexport-probe",
    "workspace-probe",
    "dead-probe",
    "unused-probe",
    "unused-reexport-probe",
    "virtual-probe",
  ]) {
    await installPackage(modules, name, version, esm(version))
  }
  // Only subpaths are exported, so `@probe/scoped/package.json` cannot be resolved.
  await installPackage(
    modules,
    "@probe/scoped",
    version,
    { "index.js": "export {}\n", "sub.js": `export const version = ${JSON.stringify(version)}\n` },
    { type: "module", exports: { ".": "./index.js", "./sub": "./sub.js" } },
  )
  for (const name of ["cjs-probe", "require-probe"]) {
    await installPackage(
      modules,
      name,
      version,
      { "index.cjs": `exports.version = ${JSON.stringify(version)}\n` },
      { main: "index.cjs" },
    )
  }
  await installPackage(
    modules,
    "dual-probe",
    version,
    {
      "index.mjs": `export const version = ${JSON.stringify(version)}\n`,
      "index.cjs": `exports.version = ${JSON.stringify(version)}\n`,
    },
    { exports: { import: "./index.mjs", require: "./index.cjs" } },
  )
  await installPackage(modules, "side-probe", version, {
    "index.js": `globalThis.sideProbe = [...(globalThis.sideProbe ?? []), ${JSON.stringify(version)}]\n`,
  })
}

/**
 * Create an application whose own code imports version 1.0.0 of every probe package and a bundled
 * composition outside its root that imports 2.0.0, like a root composition injected into a child.
 */
async function createComposition() {
  const dir = await mkdtemp(join(tmpdir(), "nuxt-multi-app-externals-"))
  workspaces.push(dir)
  const app = join(dir, "app")
  const appModules = join(app, "node_modules")
  const composition = join(dir, "composition")
  await installProbes(appModules, "1.0.0")
  await installProbes(join(composition, "node_modules"), "2.0.0")

  // Equal versions, including a modified copy that only the version number cannot tell apart.
  for (const modules of [appModules, join(composition, "node_modules")]) {
    await installPackage(modules, "same-probe", "1.0.0", esm("1.0.0"))
  }
  await installPackage(appModules, "patched-probe", "1.0.0", {
    "index.js": 'export const marker = "original"\n',
  })
  await installPackage(join(composition, "node_modules"), "patched-probe", "1.0.0", {
    "index.js": 'export const marker = "patched"\n',
  })

  // External parents with their own versions, next to a direct import of a third version.
  await installPackage(appModules, "leaf-probe", "3.0.0", esm("3.0.0"))
  for (const [parent, version] of [
    ["parent-a", "1.0.0"],
    ["parent-b", "2.0.0"],
  ] as const) {
    await installPackage(appModules, parent, "1.0.0", {
      "index.js": 'export { version } from "leaf-probe"\n',
    })
    await installPackage(
      join(appModules, parent, "node_modules"),
      "leaf-probe",
      version,
      esm(version),
    )
  }

  // A workspace package linked into the application is bundled with its own dependencies.
  const workspace = join(dir, "workspace-lib")
  await write(join(workspace, "package.json"), '{"name":"workspace-lib","type":"module"}')
  await write(
    join(workspace, "index.js"),
    'export { version as workspace } from "workspace-probe"\n',
  )
  await installPackage(join(workspace, "node_modules"), "workspace-probe", "2.0.0", esm("2.0.0"))
  await symlink(workspace, join(appModules, "workspace-lib"), "dir")

  await write(
    join(composition, "index.js"),
    `import { version } from "version-probe"
import { version as scoped } from "@probe/scoped/sub"
import cjs from "cjs-probe"
import { version as dual } from "dual-probe"
import { version as explicit } from "explicit-probe"
import { reexport } from "./barrel.js"
import "side-probe"
import requireProbe from "./legacy.js"
import { version as dead } from "dead-probe"
import { version as unused } from "unused-probe"
import { version as same } from "same-probe"
import { marker as patched } from "patched-probe"
import { version as virtual } from "virtual-probe"

const never = false

export async function composition() {
  if (never) console.log(dead)
  const { version: dynamic } = await import("dynamic-probe")
  return { version, scoped, cjs: cjs.version, dual, explicit, reexport, dynamic, require: requireProbe, same, patched, virtual }
}
`,
  )
  await write(join(composition, "barrel.js"), 'export * from "./reexports.js"\n')
  await write(
    join(composition, "reexports.js"),
    'export { version as reexport } from "reexport-probe"\nexport { version as unusedReexport } from "unused-reexport-probe"\n',
  )
  await write(join(composition, "legacy.js"), 'module.exports = require("require-probe").version\n')

  await write(
    join(app, "routes/versions.ts"),
    `import { version } from "version-probe"
import { version as scoped } from "@probe/scoped/sub"
import cjs from "cjs-probe"
import { version as dual } from "dual-probe"
import { version as explicit } from "explicit-probe"
import { version as reexport } from "reexport-probe"
import "side-probe"
import requireProbe from "require-probe"
import { version as dead } from "dead-probe"
import { version as unused } from "unused-probe"
import { version as unusedReexport } from "unused-reexport-probe"
import { version as same } from "same-probe"
import { marker as patched } from "patched-probe"
import { version as leaf } from "leaf-probe"
import { version as a } from "parent-a"
import { version as b } from "parent-b"
import { version as workspaceProbe } from "workspace-probe"
import { workspace } from "workspace-lib"
import { version as virtual } from "#virtual-probe"
import { composition } from "#composition"

export default defineEventHandler(async () => ({
  app: {
    version, scoped, cjs: cjs.version, dual, explicit, reexport, require: requireProbe.version,
    dynamic: (await import("dynamic-probe")).version, dead, unused, unusedReexport, same, patched,
    workspace: workspaceProbe,
    virtual,
  },
  composition: await composition(),
  parents: { leaf, a, b },
  workspace,
  side: globalThis.sideProbe,
}))
`,
  )
  return { dir, app, composition }
}

interface BuildResult {
  error?: Error
  output: string
}

async function buildNitro(
  rootDir: string,
  config: NitroConfig = {},
  beforeCheck?: (nitro: Nitro) => void,
): Promise<BuildResult> {
  const output = join(rootDir, ".output")
  const nitro = await createNitro({
    rootDir,
    dev: false,
    preset: "node",
    logLevel: 0,
    compatibilityDate: "2026-09-12",
    output: { dir: output },
    alias: { "#composition": join(rootDir, "../composition/index.js") },
    virtual: { "#virtual-probe": 'export { version } from "virtual-probe"' },
    moduleSideEffects: ["side-probe"],
    ...config,
  })
  beforeCheck?.(nitro)
  checkNitroExternalVersions(nitro, "app")
  let error: Error | undefined
  try {
    await prepare(nitro)
    await copyPublicAssets(nitro)
    await build(nitro)
  } catch (thrown) {
    error = thrown as Error
  } finally {
    await nitro.close()
  }
  return { error, output }
}

/** Run the built route from a copy of the output moved away from the installed packages. */
async function requestVersions(output: string) {
  const moved = await mkdtemp(join(tmpdir(), "nuxt-multi-app-externals-output-"))
  workspaces.push(moved)
  await cp(output, moved, { recursive: true, verbatimSymlinks: true })
  const glob = new Bun.Glob("server/chunks/**/versions.mjs")
  const [route] = await Array.fromAsync(glob.scan(moved))
  if (!route) throw new Error("The versions route was not built")
  const handler = (await import(pathToFileURL(join(moved, route)).href)).default
  return handler({})
}

function isPlugin(value: unknown): value is { name: string } {
  return typeof value === "object" && value !== null && "name" in value
}

/** Split a conflict message into the package sections it lists. */
function conflictPackages(message: string) {
  return [...message.matchAll(/^(\S+)\n {2}1\.0\.0\n[^]*?\n {2}2\.0\.0\n/gm)].map(
    (match) => match[1],
  )
}

describe("external package versions", () => {
  it(
    "fails when bundled code imports two versions of one external package",
    async () => {
      const { app } = await createComposition()
      const { error } = await buildNitro(app, { externals: { external: ["explicit-probe"] } })
      expect(error?.message).toContain(
        'App "app" bundles imports that resolve to different versions',
      )
      expect(conflictPackages(error!.message).sort()).toEqual(CONFLICTING)
      expect(error!.message).toContain("Imports that tree shaking removes count as well")
      expect(error!.message).toContain(
        '"unused-reexport-probe" -> ../composition/node_modules/unused-reexport-probe/index.js\n      from ../composition/reexports.js',
      )
      expect(error!.message).toContain(
        '"version-probe" -> node_modules/version-probe/index.js\n      from routes/versions.ts',
      )
      expect(error!.message).toContain(
        '"@probe/scoped/sub" -> ../composition/node_modules/@probe/scoped/sub.js\n      from ../composition/index.js',
      )
      expect(error!.message).toContain("from ../composition/reexports.js")
      expect(error!.message).toContain(
        `inline: [${CONFLICTING.map((name) => JSON.stringify(name)).join(", ")}]`,
      )
    },
    BUILD_TIMEOUT,
  )

  it(
    "keeps both versions when the conflicting packages are inlined",
    async () => {
      const { app } = await createComposition()
      const { error, output } = await buildNitro(app, {
        externals: { inline: CONFLICTING },
      })
      expect(error).toBeUndefined()
      const versions = await requestVersions(output)
      const app1 = Object.fromEntries(
        [
          "version",
          "scoped",
          "cjs",
          "dual",
          "explicit",
          "reexport",
          "require",
          "dynamic",
          "virtual",
        ].map((key) => [key, "1.0.0"]),
      )
      expect(versions.app).toEqual({
        ...app1,
        dead: "1.0.0",
        unused: "1.0.0",
        unusedReexport: "1.0.0",
        same: "1.0.0",
        workspace: "1.0.0",
        // Equal versions are not compared: both importers receive the same copy.
        patched: versions.composition.patched,
      })
      expect(versions.composition).toEqual({
        ...Object.fromEntries(Object.keys(app1).map((key) => [key, "2.0.0"])),
        same: "1.0.0",
        patched: versions.composition.patched,
      })
      expect(versions.parents).toEqual({
        leaf: "3.0.0",
        a: "1.0.0",
        b: "2.0.0",
      })
      expect(versions.workspace).toBe("2.0.0")
      expect(versions.side.toSorted()).toEqual(["1.0.0", "2.0.0"])
    },
    BUILD_TIMEOUT,
  )

  it(
    "is skipped when Nitro bundles every dependency",
    async () => {
      const { app } = await createComposition()
      const { error, output } = await buildNitro(app, { noExternals: true })
      expect(error).toBeUndefined()
      const versions = await requestVersions(output)
      expect([versions.app.version, versions.composition.version]).toEqual(["1.0.0", "2.0.0"])
    },
    BUILD_TIMEOUT,
  )

  it(
    "fails when Nitro's output replaces a direct import with a transitive version",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "nuxt-multi-app-externals-"))
      workspaces.push(dir)
      const modules = join(dir, "app/node_modules")
      await installPackage(modules, "version-probe", "1.0.0", esm("1.0.0"))
      for (const [parent, version] of [
        ["parent-a", "1.0.0"],
        ["parent-b", "2.0.0"],
      ] as const) {
        await installPackage(modules, parent, "1.0.0", {
          "index.js": 'export { version } from "version-probe"\n',
        })
        await installPackage(
          join(modules, parent, "node_modules"),
          "version-probe",
          version,
          esm(version),
        )
      }
      await write(
        join(dir, "app/routes/versions.ts"),
        `import { version } from "version-probe"
import { version as a } from "parent-a"
import { version as b } from "parent-b"
export default defineEventHandler(() => ({ version, a, b }))
`,
      )
      const { error } = await buildNitro(join(dir, "app"))
      expect(error?.message).toContain(
        'App "app" production output resolves external imports to package versions they were not resolved to',
      )
      expect(error!.message).toContain(
        "version-probe: imported as 1.0.0, the output provides version-probe@2.0.0\n" +
          '  "version-probe" -> node_modules/version-probe/index.js\n' +
          "    from routes/versions.ts\n" +
          "  output: .output/server/node_modules/.nitro/version-probe@2.0.0/index.js",
      )
    },
    BUILD_TIMEOUT,
  )

  it(
    "resolves the output with the conditions Node applies at run time",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "nuxt-multi-app-externals-"))
      workspaces.push(dir)
      // Nitro traces only the file of its own conditions, while Node selects another branch.
      const modules = join(dir, "app/node_modules")
      for (const [name, condition] of [
        ["worker-probe", "worker"],
        ["sync-probe", "module-sync"],
        ["addons-probe", "node-addons"],
      ] as const) {
        await installPackage(
          modules,
          name,
          "1.0.0",
          { "branch.js": 'export const version = "branch"\n', ...esm("1.0.0") },
          {
            type: "module",
            exports: { [condition]: "./branch.js", default: "./index.js" },
          },
        )
      }
      await write(
        join(dir, "app/routes/versions.ts"),
        `import { version as worker } from "worker-probe"
import { version as sync } from "sync-probe"
import { version as addons } from "addons-probe"
export default defineEventHandler(() => ({ worker, sync, addons }))
`,
      )
      const { error } = await buildNitro(join(dir, "app"), { exportConditions: ["worker"] })
      for (const name of ["worker-probe", "sync-probe", "addons-probe"]) {
        expect(error?.message).toContain(`${name}: imported as 1.0.0, the output provides nothing`)
      }
    },
    BUILD_TIMEOUT,
  )

  it(
    "rejects a Nitro build without the expected externals plugin",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "nuxt-multi-app-externals-"))
      workspaces.push(dir)
      await write(join(dir, "app/routes/index.ts"), "export default defineEventHandler(() => 1)\n")
      const { error } = await buildNitro(join(dir, "app"), {}, (nitro) => {
        nitro.hooks.hook("rollup:before", (_nitro, config) => {
          for (const plugin of config.plugins as unknown[]) {
            if (isPlugin(plugin) && plugin.name === "node-externals") plugin.name = "renamed"
          }
        })
      })
      expect(error?.message).toContain(
        "nuxt-multi-app: the Nitro node-externals plugin contract changed",
      )
    },
    BUILD_TIMEOUT,
  )
})
