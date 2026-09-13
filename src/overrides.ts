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
    ...(prepare ? { _prepare: true } : undefined),
    buildDir: app.buildDir,
    // A mounted child has no listener of its own, so it describes the root's public one.
    ...(rootDevServer
      ? {
          devServer: { ...rootDevServer, ...overrides.devServer },
        }
      : undefined),
    // Vite's default cache lives under the child root and would be shared with standalone runs.
    vite: { ...overrides.vite, cacheDir: `${app.buildDir}/cache/vite` },
  } as NuxtConfig
}
