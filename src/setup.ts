import type { Nuxt } from "nuxt/schema"

import { setupDevelopment } from "./dev"
import { normalizeOptions } from "./normalize-options"
import { configureNuxtApp } from "./nuxt/configure"
import type { ModuleOptions } from "./options"
import { prepareComposition } from "./prepare"
import { setupProductionBuild } from "./production"
import { assertSharedDependencies } from "./shared-dependencies"

/** Run the Nuxt module lifecycle for prepare, development, or production build. */
export async function setupModule(input: ModuleOptions, nuxt: Nuxt) {
  const options = normalizeOptions(input, nuxt)
  // Fail in every mode before any child loads, so separate copies never start serving.
  assertSharedDependencies(options)
  const ids = options.allApps.map((app) => app.id)
  const projectModules = [
    ...options.routing.flatMap((rule) => ("resolver" in rule ? [rule.resolver] : [])),
    ...(options.fallback ? [options.fallback] : []),
  ]
  nuxt.options.watch.push(...projectModules)

  if (nuxt.options._prepare) {
    configureNuxtApp(nuxt, options.root, { ids, projectModules })
    prepareComposition(options, nuxt)
    return
  }

  if (!nuxt.options.dev) {
    configureNuxtApp(nuxt, options.root, { ids, projectModules })
    setupProductionBuild(options, nuxt)
    return
  }

  await setupDevelopment(options, nuxt, { ids, projectModules })
}
