import { buildNuxt, loadNuxt, writeTypes } from "@nuxt/kit"

import { configureNuxtApp } from "./configure-app"
import type { NormalizedModuleOptions } from "./options"
import { childOverrides } from "./overrides"

/** Generate declarations for every child using its mounted configuration profile. */
export async function prepareChildren(options: NormalizedModuleOptions) {
  const ids = options.allApps.map((app) => app.id)
  for (const app of options.apps) {
    const overrides = childOverrides(app, undefined, true)
    const child = await loadNuxt({
      cwd: app.rootDir,
      dev: false,
      ready: false,
      dotenv: false,
      overrides,
    })
    configureNuxtApp(child, app, { ids })
    try {
      await child.ready()
      await buildNuxt(child)
      await child.runWithContext(() => writeTypes(child))
    } finally {
      await child.close()
    }
  }
}
