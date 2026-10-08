import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { Nuxt } from "nuxt/schema"

import { bundleProjectModule } from "../bundle"
import { FALLBACK_FILE, moduleBuildDir, resolverFile, serverDir } from "../layout"
import type { NormalizedModuleOptions } from "../options"
import { loadFactory } from "../runtime/factories"
import { defaultFallback, FALLBACK_LABEL, type MultiAppFallback } from "../runtime/fallback"
import { mapResolvers, resolverLabel, type MultiAppResolver } from "../runtime/routing"

/** Build and load the project's development routing and fallback modules. */
export async function loadDevModules(options: NormalizedModuleOptions, nuxt: Nuxt) {
  async function load<T extends (...args: never[]) => unknown>(
    input: string,
    file: string,
    label: string,
  ) {
    const output = resolve(serverDir(moduleBuildDir(nuxt.options.buildDir)), file)
    await bundleProjectModule(input, output, nuxt)
    // The query defeats the ESM cache, so a full Nuxt restart imports the freshly bundled module.
    return loadFactory<T>(`${pathToFileURL(output).href}?t=${Date.now()}`, label)
  }
  const routing = await mapResolvers(options.routing, (input, index) =>
    load<MultiAppResolver>(input, resolverFile(index), resolverLabel(index)),
  )
  const fallback = options.fallback
    ? await load<MultiAppFallback>(options.fallback, FALLBACK_FILE, FALLBACK_LABEL)
    : defaultFallback
  return [routing, fallback] as const
}
