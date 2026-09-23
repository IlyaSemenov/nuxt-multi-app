import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { buildNuxt, loadNuxt, writeTypes } from "@nuxt/kit"
import type { Nuxt } from "nuxt/schema"

import { withGlobalNuxtContext } from "./compat"
import { configureNuxtApp } from "./configure-app"
import { relativePath, TYPECHECK_SOLUTION } from "./layout"
import type { NormalizedModuleOptions } from "./options"
import { childOverrides } from "./overrides"

const TYPESCRIPT_PROJECTS = ["app", "server", "shared", "node"] as const

/** Register generation of the composition solution and every child's mounted declarations. */
export function prepareComposition(options: NormalizedModuleOptions, root: Nuxt) {
  root.hook("prepare:types", async () => {
    await mkdir(options.root.buildDir, { recursive: true })
    await writeFile(resolve(options.root.buildDir, TYPECHECK_SOLUTION), typecheckSolution(options))
  })
  // Nuxt CLI clears the root build directory after module setup, so nested child artifacts must
  // be generated from the build lifecycle that follows that cleanup.
  root.hook("build:before", () => prepareChildren(options))
}

async function prepareChildren(options: NormalizedModuleOptions) {
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
      await withGlobalNuxtContext(child, async () => {
        await child.ready()
        await buildNuxt(child)
        await child.runWithContext(() => writeTypes(child))
      })
    } finally {
      await child.close()
    }
  }
}

/** Generate a TypeScript solution that checks every Nuxt profile in the composition. */
function typecheckSolution(options: NormalizedModuleOptions) {
  const references = options.allApps.flatMap((app) =>
    TYPESCRIPT_PROJECTS.map((project) => ({
      path: relativePath(options.root.buildDir, resolve(app.buildDir, `tsconfig.${project}.json`)),
    })),
  )
  return `${JSON.stringify({ files: [], references }, null, 2)}\n`
}
