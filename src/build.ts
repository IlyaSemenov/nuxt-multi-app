import { cp, mkdir, writeFile } from "node:fs/promises"
import { dirname, relative, resolve, sep } from "node:path"

import { buildNuxt, createResolver, loadNuxt } from "@nuxt/kit"
import type {} from "@nuxt/nitro-server"
import type { Nuxt } from "nuxt/schema"

import { bundleProjectModule } from "./bundle"
import { applyHandlerOutput, configureNuxtApp } from "./configure-app"
import type { NormalizedAppOptions, NormalizedModuleOptions } from "./options"
import { MODULE_OUTPUT_DIR, PRODUCTION_ENTRY } from "./options"
import { childOverrides } from "./overrides"

const resolver = createResolver(import.meta.url)
const runtimeDir = resolver.resolve("./runtime")

/** Build every application as an isolated handler and write the common production entry. */
export function setupProductionBuild(options: NormalizedModuleOptions, root: Nuxt) {
  applyHandlerOutput(root.options.nitro, options.root.id)
  const rootEntry = captureServerEntry(root)
  let outputDir: string | undefined
  root.hook("nitro:init", (nitro) => {
    outputDir = nitro.options.output.dir
  })
  root.hook("ready", () => {
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
    await child.ready()
    await buildNuxt(child)
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
  await mkdir(entryDir, { recursive: true })
  // Module Builder emits authored .mjs runtime sources as .js while preserving their
  // specifiers, so copy the shared files back under the names used by the entry source.
  await cp(resolve(runtimeDir, "server.js"), entry)
  for (const name of ["factories", "request", "routing", "state"]) {
    await cp(resolve(runtimeDir, `${name}.js`), resolve(entryDir, `${name}.mjs`))
  }

  const resolverFile = options.resolver ? "resolver.mjs" : undefined
  const stateHandlerFile = options.stateHandler ? "state-handler.mjs" : undefined
  if (options.resolver) {
    await bundleProjectModule(options.resolver, resolve(entryDir, resolverFile!), nuxt)
  }
  if (options.stateHandler) {
    await bundleProjectModule(options.stateHandler, resolve(entryDir, stateHandlerFile!), nuxt)
  }

  const apps = entries.map((app) => ({ ...app, entry: toRelativeUrl(entryDir, app.entry) }))
  const manifest = {
    apps,
    fallback: options.fallback,
    resolver: resolverFile ? `./${resolverFile}` : null,
    stateHandler: stateHandlerFile ? `./${stateHandlerFile}` : null,
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
        routing: routingMode(Boolean(resolverFile), apps),
        apps: apps.map(({ id, hosts, entry }) => ({ id, hosts, entry })),
      },
      null,
      2,
    )}\n`,
  )
  console.log(`[nuxt-multi-app] entry ${entry}`)
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
