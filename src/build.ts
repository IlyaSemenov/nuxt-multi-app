import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"

import { buildNuxt, createResolver, loadNuxt } from "@nuxt/kit"
import type {} from "@nuxt/nitro-server"
import type { Nuxt } from "nuxt/schema"

import { bundleForOutput, bundleProjectModule } from "./bundle"
import { withGlobalNuxtContext } from "./compat"
import { applyHandlerOutput, configureNuxtApp } from "./configure-app"
import { logger } from "./logger"
import type { NormalizedAppOptions, NormalizedModuleOptions } from "./options"
import { MODULE_OUTPUT_DIR, PRODUCTION_ENTRY, PROJECT_MODULES } from "./options"
import { childOverrides } from "./overrides"

const resolver = createResolver(import.meta.url)
const serverEntry = resolver.resolve("./runtime/server.js")

/** Build every application as an isolated handler and write the common production entry. */
export function setupProductionBuild(options: NormalizedModuleOptions, root: Nuxt) {
  applyHandlerOutput(root.options.nitro, options.root.id)
  const rootOutput = captureNitroOutput(root)
  root.hook("ready", () => {
    // Nitro cleans and writes the root output from a `build:done` hook it registers while Nuxt
    // becomes ready; registering afterwards lets children build into the finished directory.
    root.hook("build:done", async () => {
      const output = rootOutput()
      // Relocate only after Nitro finishes so its configured output root and top-level build
      // metadata remain the canonical output discovered by `nuxt preview`.
      const rootEntry = await relocateRootOutput(output, options.root.id)
      const entries = [{ id: options.root.id, hosts: options.root.hosts, entry: rootEntry }]
      for (const app of options.apps) {
        entries.push({
          id: app.id,
          hosts: app.hosts,
          entry: await buildChild(
            app,
            output.dir,
            options.allApps.map(({ id }) => id),
          ),
        })
      }
      await writeProductionServer(output.dir, entries, options, root)
    })
  })
}

interface NitroOutput {
  dir: string
  publicDir: string
  serverDir: string
  entry: string
}

function captureNitroOutput(nuxt: Nuxt) {
  let output: NitroOutput | undefined
  nuxt.hook("nitro:init", (nitro) => {
    output = {
      ...nitro.options.output,
      entry: resolve(nitro.options.output.serverDir, "index.mjs"),
    }
  })
  return () => {
    if (!output) throw new Error("nuxt-multi-app: Nitro was not initialized")
    return output
  }
}

/** Move the root handler under the same registry layout as every mounted application. */
async function relocateRootOutput(output: NitroOutput, id: string) {
  const appDir = resolve(output.dir, MODULE_OUTPUT_DIR, "apps", id)
  await mkdir(appDir, { recursive: true })
  await rename(output.serverDir, resolve(appDir, "server"))
  await rename(output.publicDir, resolve(appDir, "public"))
  // Preserve the root handler's own Nitro metadata before the top-level copy is changed to launch
  // the multiplexer.
  await copyFile(resolve(output.dir, "nitro.json"), resolve(appDir, "nitro.json"))
  return resolve(appDir, "server", relative(output.serverDir, output.entry))
}

async function buildChild(app: NormalizedAppOptions, outputDir: string, ids: string[]) {
  const overrides = childOverrides(app)
  overrides.nitro = {
    ...overrides.nitro,
    output: {
      ...overrides.nitro?.output,
      dir: resolve(outputDir, MODULE_OUTPUT_DIR, "apps", app.id),
    },
  }
  const child = await loadNuxt({
    cwd: app.rootDir,
    dev: false,
    ready: false,
    dotenv: false,
    overrides,
  })
  configureNuxtApp(child, app, { ids })
  applyHandlerOutput(child.options.nitro, app.id)
  const output = captureNitroOutput(child)
  try {
    await withGlobalNuxtContext(child, async () => {
      await child.ready()
      await buildNuxt(child)
    })
  } finally {
    await child.close()
  }
  return output().entry
}

async function writeProductionServer(
  outputDir: string,
  entries: { id: string; hosts: string[]; entry: string }[],
  options: NormalizedModuleOptions,
  nuxt: Nuxt,
) {
  const entry = resolve(outputDir, PRODUCTION_ENTRY)
  const entryDir = dirname(entry)
  const moduleDir = resolve(outputDir, MODULE_OUTPUT_DIR)
  // The output runs without this package installed, so the entry is bundled from the built runtime.
  await bundleForOutput(serverEntry, entry)

  const projectModules = { resolver: null as string | null, stateHandler: null as string | null }
  for (const key of ["resolver", "stateHandler"] as const) {
    const input = options[key]
    if (!input) continue
    const { file } = PROJECT_MODULES[key]
    const output = resolve(moduleDir, file)
    await bundleProjectModule(input, output, nuxt)
    projectModules[key] = toRelativeUrl(entryDir, output)
  }

  const apps = entries.map((app) => ({ ...app, entry: toRelativeUrl(entryDir, app.entry) }))
  const manifest = {
    apps,
    fallback: options.fallback,
    ...projectModules,
    readinessPath: options.readinessPath,
    shutdownTimeout: options.shutdownTimeout,
    debug: options.debug,
  }
  await writeFile(resolve(moduleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(
    resolve(moduleDir, "report.json"),
    `${JSON.stringify(
      {
        entry: PRODUCTION_ENTRY,
        routing: routingMode(Boolean(options.resolver), apps),
        apps: apps.map(({ id, hosts, entry }) => ({ id, hosts, entry })),
      },
      null,
      2,
    )}\n`,
  )
  await setPreviewCommand(outputDir)
  logger.info(`entry ${entry}`)
}

/** Point Nitro-compatible launchers at the multiplexer instead of an import-only app handler. */
async function setPreviewCommand(outputDir: string) {
  const path = resolve(outputDir, "nitro.json")
  const buildInfo = JSON.parse(await readFile(path, "utf8")) as {
    commands?: { preview?: string; deploy?: string }
  }
  buildInfo.commands ??= {}
  // Nuxt runs this command with the Nitro output directory as its working directory.
  buildInfo.commands.preview = `node ./${PRODUCTION_ENTRY}`
  await writeFile(path, `${JSON.stringify(buildInfo, null, 2)}\n`)
}

function routingMode(hasResolver: boolean, apps: { hosts: string[] }[]) {
  const hasHosts = apps.some((app) => app.hosts.length > 0)
  if (hasResolver && hasHosts) return "resolver-and-hosts"
  if (hasResolver) return "resolver"
  return "hosts"
}

function toRelativeUrl(from: string, to: string) {
  const path = relative(from, to).split(sep).join("/")
  return path.startsWith(".") ? path : `./${path}`
}
