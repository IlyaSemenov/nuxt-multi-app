import { copyFile, readFile, writeFile } from "node:fs/promises"
import { dirname, resolve } from "node:path"

import { buildNuxt, createResolver, loadNuxt } from "@nuxt/kit"
import type {} from "@nuxt/nitro-server"
import type { Nuxt } from "nuxt/schema"

import { bundleForOutput, bundleProjectModule } from "./bundle"
import { withGlobalNuxtContext } from "./compat"
import { applyHandlerOutput, configureNuxtApp } from "./configure-app"
import { relativePath } from "./layout"
import { logger } from "./logger"
import type { NormalizedAppOptions, NormalizedModuleOptions } from "./options"
import {
  MODULE_OUTPUT_DIR,
  PRODUCTION_ENTRY,
  PROJECT_MODULES,
  resolverProjectModule,
} from "./options"
import { childOverrides } from "./overrides"
import type { ProductionManifest } from "./runtime/registry"
import { mapResolvers } from "./runtime/routing"

const resolver = createResolver(import.meta.url)
const serverEntry = resolver.resolve("./runtime/server.js")

/** Build every application as an isolated handler and write the common production entry. */
export function setupProductionBuild(options: NormalizedModuleOptions, root: Nuxt) {
  applyHandlerOutput(root.options.nitro, options.root.id)
  const rootOutput = captureNitroOutput(root, options.root.id)
  root.hook("ready", () => {
    // Nitro cleans and writes the root output from a `build:done` hook it registers while Nuxt
    // becomes ready; registering afterwards lets children build into the finished directory.
    root.hook("build:done", async () => {
      const output = rootOutput()
      const entries = [
        {
          id: options.root.id,
          entry: output.entry,
        },
      ]
      for (const app of options.apps) {
        entries.push({
          id: app.id,
          entry: await buildChild(
            app,
            output.dir,
            options.allApps.map(({ id }) => id),
          ),
        })
      }
      // Nitro integrations may modify the generated handler from their close hooks, so install the
      // multiplexer only after Nitro and every other hook registered before the completed build.
      root.hook("close", async () => {
        await copyFile(
          resolve(output.dir, "nitro.json"),
          resolve(output.dir, MODULE_OUTPUT_DIR, "apps", options.root.id, "nitro.json"),
        )
        await writeProductionServer(output.dir, entries, options, root)
      })
    })
  })
}

interface NitroOutput {
  dir: string
  entry: string
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

/** Capture the Nitro entry, placing the root handler in its final directory when given its ID. */
function captureNitroOutput(nuxt: Nuxt, rootId?: string) {
  let output: NitroOutput | undefined
  nuxt.hook("nitro:init", (nitro) => {
    if (rootId !== undefined) {
      const appDir = resolve(nitro.options.output.dir, MODULE_OUTPUT_DIR, "apps", rootId)
      nitro.options.output.serverDir = resolve(appDir, "server")
      nitro.options.output.publicDir = resolve(appDir, "public")
    }
    output = {
      dir: nitro.options.output.dir,
      entry: resolve(nitro.options.output.serverDir, "index.mjs"),
    }
  })
  return () => {
    if (!output) throw new Error("nuxt-multi-app: Nitro was not initialized")
    return output
  }
}

async function writeProductionServer(
  outputDir: string,
  entries: { id: string; entry: string }[],
  options: NormalizedModuleOptions,
  nuxt: Nuxt,
) {
  const entry = resolve(outputDir, PRODUCTION_ENTRY)
  const entryDir = dirname(entry)
  const moduleDir = resolve(outputDir, MODULE_OUTPUT_DIR)
  // The output runs without this package installed, so the entry is bundled from the built runtime.
  await bundleForOutput(serverEntry, entry)

  const routing = await mapResolvers(options.routing, async (input, index) => {
    const output = resolve(moduleDir, resolverProjectModule(index).file)
    await bundleProjectModule(input, output, nuxt)
    return relativePath(entryDir, output)
  })

  let stateHandler: string | null = null
  if (options.stateHandler) {
    const output = resolve(moduleDir, PROJECT_MODULES.stateHandler.file)
    await bundleProjectModule(options.stateHandler, output, nuxt)
    stateHandler = relativePath(entryDir, output)
  }

  const apps = entries.map((app) => ({ ...app, entry: relativePath(entryDir, app.entry) }))
  const manifest: ProductionManifest = {
    apps,
    routing,
    stateHandler,
    readinessPath: options.readinessPath,
    shutdownTimeout: options.shutdownTimeout,
    debug: options.debug,
  }
  await writeFile(resolve(moduleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
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
