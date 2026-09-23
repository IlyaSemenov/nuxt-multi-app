import { buildNuxt, loadNuxt } from "@nuxt/kit"
import type { Nuxt, NuxtConfig } from "nuxt/schema"

import { withGlobalNuxtContext } from "./compat"
import { configureNuxtApp, type RuntimeSettings } from "./configure-app"
import type { NormalizedAppOptions } from "./options"

/** How a mounted child is loaded: served in development, prepared for types, or built for production. */
export type ChildMode =
  | { type: "dev"; devServer: NuxtConfig["devServer"] }
  | { type: "prepare" }
  | { type: "build"; outputDir: string }

/** Load a mounted child from its own configuration plus the documented mount overrides. */
export async function loadChildNuxt(
  app: NormalizedAppOptions,
  mode: ChildMode,
  settings: RuntimeSettings,
) {
  const nuxt = await loadNuxt({
    cwd: app.rootDir,
    dev: mode.type === "dev",
    ready: false,
    dotenv: false,
    overrides: childOverrides(app, mode),
  })
  configureNuxtApp(nuxt, app, settings)
  return nuxt
}

/** Build a loaded child once while it owns the global Kit context, then close it. */
export async function buildChildOnce(nuxt: Nuxt, afterBuild?: () => Promise<void>) {
  try {
    await withGlobalNuxtContext(nuxt, async () => {
      await nuxt.ready()
      await buildNuxt(nuxt)
      await afterBuild?.()
    })
  } finally {
    await nuxt.close()
  }
}

/** Build the complete set of documented root-to-child overrides. */
function childOverrides(app: NormalizedAppOptions, mode: ChildMode): NuxtConfig {
  const overrides = app.overrides
  return {
    ...overrides,
    // Nuxt's internal prepare mode generates templates without starting a normal build.
    ...(mode.type === "prepare" ? { _prepare: true } : undefined),
    buildDir: app.buildDir,
    // A mounted child has no listener of its own, so it describes the root's public one.
    ...(mode.type === "dev"
      ? { devServer: { ...mode.devServer, ...overrides.devServer } }
      : undefined),
    ...(mode.type === "build"
      ? {
          nitro: {
            ...overrides.nitro,
            output: { ...overrides.nitro?.output, dir: mode.outputDir },
          },
        }
      : undefined),
    // Vite's default cache lives under the child root and would be shared with standalone runs.
    vite: { ...overrides.vite, cacheDir: `${app.buildDir}/cache/vite` },
  } as NuxtConfig
}
