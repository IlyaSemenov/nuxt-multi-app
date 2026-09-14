import { writeFile } from "node:fs/promises"
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
  const rootEntry = captureServerEntry(root)
  let outputDir: string | undefined
  root.hook("nitro:init", (nitro) => {
    outputDir = nitro.options.output.dir
  })
  root.hook("ready", () => {
    // Nitro cleans and writes the root output from a `build:done` hook it registers while Nuxt
    // becomes ready; registering afterwards lets children build into the finished directory.
    root.hook("build:done", async () => {
      if (!outputDir) throw new Error("nuxt-multi-app: root Nitro output is unknown")
      const entries = [{ id: options.root.id, hosts: options.root.hosts, entry: rootEntry() }]
      for (const app of options.apps) {
        entries.push({
          id: app.id,
          hosts: app.hosts,
          entry: await buildChild(
            app,
            outputDir,
            options.allApps.map(({ id }) => id),
          ),
        })
      }
      await writeProductionServer(outputDir, entries, options, root)
    })
  })
}

function captureServerEntry(nuxt: Nuxt) {
  let entry: string | undefined
  nuxt.hook("nitro:init", (nitro) => {
    entry = resolve(nitro.options.output.serverDir, "index.mjs")
  })
  return () => {
    if (!entry) throw new Error("nuxt-multi-app: Nitro was not initialized")
    return entry
  }
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
  const entry = captureServerEntry(child)
  try {
    await withGlobalNuxtContext(child, async () => {
      await child.ready()
      await buildNuxt(child)
    })
  } finally {
    await child.close()
  }
  return entry()
}

async function writeProductionServer(
  outputDir: string,
  entries: { id: string; hosts: string[]; entry: string }[],
  options: NormalizedModuleOptions,
  nuxt: Nuxt,
) {
  const entry = resolve(outputDir, PRODUCTION_ENTRY)
  const entryDir = dirname(entry)
  // The output runs without this package installed, so the entry is bundled from the built runtime.
  await bundleForOutput(serverEntry, entry)

  const projectModules = { resolver: null as string | null, stateHandler: null as string | null }
  for (const key of ["resolver", "stateHandler"] as const) {
    const input = options[key]
    if (!input) continue
    const { file } = PROJECT_MODULES[key]
    await bundleProjectModule(input, resolve(entryDir, file), nuxt)
    projectModules[key] = `./${file}`
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
  await writeFile(resolve(entryDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
  await writeFile(
    resolve(entryDir, "report.json"),
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
  logger.info(`entry ${entry}`)
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
