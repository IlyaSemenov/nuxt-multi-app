import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { writeTypes } from "nuxt/kit"
import type { Nuxt } from "nuxt/schema"

import { relativePath, TYPECHECK_SOLUTION } from "./layout"
import { buildChildOnce, loadChildNuxt } from "./nuxt/load-child"
import type { NormalizedModuleOptions } from "./options"

const TYPESCRIPT_PROJECTS = ["app", "server", "shared", "node"] as const

/** Register generation of the composition solution and every child's mounted declarations. */
export function prepareComposition(options: NormalizedModuleOptions, root: Nuxt) {
  // Nuxt 4.6 writes the root's generated projects to `typesDir`, which Nuxt 4.5 does not have.
  const typesDir = root.options.typesDir ?? root.options.buildDir
  root.hook("prepare:types", async () => {
    await mkdir(typesDir, { recursive: true })
    await writeFile(resolve(typesDir, TYPECHECK_SOLUTION), typecheckSolution(options, typesDir))
  })
  // Nuxt CLI clears the root build directory after module setup, so nested child artifacts must
  // be generated from the build lifecycle that follows that cleanup.
  root.hook("build:before", () => prepareChildren(options))
}

async function prepareChildren(options: NormalizedModuleOptions) {
  const ids = options.allApps.map((app) => app.id)
  for (const app of options.apps) {
    const child = await loadChildNuxt(app, { type: "prepare" }, { ids })
    await buildChildOnce(child, () => child.runWithContext(() => writeTypes(child)))
  }
}

/**
 * Generate a TypeScript solution, written to the root's types directory, that checks every Nuxt
 * profile in the composition. Mounted children write their types to their build directory.
 */
function typecheckSolution(options: NormalizedModuleOptions, typesDir: string) {
  const references = options.allApps.flatMap((app) =>
    TYPESCRIPT_PROJECTS.map((project) => ({
      path: relativePath(
        typesDir,
        resolve(app.isRoot ? typesDir : app.buildDir, `tsconfig.${project}.json`),
      ),
    })),
  )
  return `${JSON.stringify({ files: [], references }, null, 2)}\n`
}
