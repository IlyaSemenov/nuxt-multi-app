import type { NuxtConfig } from "nuxt/schema"

import type { NormalizedAppOptions } from "./options"

/** Build the complete set of documented root-to-child overrides. */
export function childOverrides(
  app: NormalizedAppOptions,
  rootDevServer?: NuxtConfig["devServer"],
  prepare = false,
): NuxtConfig {
  const overrides = app.overrides
  return {
    ...overrides,
    // Nuxt's internal prepare mode generates templates without starting a normal build.
    ...(prepare ? { _prepare: true } : {}),
    buildDir: app.buildDir,
    ...(rootDevServer ? { devServer: { ...rootDevServer, ...overrides.devServer } } : {}),
    vite: { ...overrides.vite, cacheDir: `${app.buildDir}/cache/vite` },
  } as NuxtConfig
}
