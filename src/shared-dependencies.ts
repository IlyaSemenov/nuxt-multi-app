// Module setup check that mounted children load selected packages from the root's installation.
import { realpathSync, statSync } from "node:fs"
import { dirname, join } from "node:path"

import type { NormalizedAppOptions, NormalizedModuleOptions } from "./options"

interface SharedDependencyProblem {
  name: string
  app: NormalizedAppOptions
  /** Package directory resolved from the root application, if any. */
  root: string | undefined
  /** Package directory resolved from the child application, if any. */
  child: string | undefined
}

/**
 * Throw when a package in a child's `sharedDependencies` does not resolve, from the child's root
 * directory, to the same installed directory as from the root application's directory.
 */
export function assertSharedDependencies(options: NormalizedModuleOptions) {
  const rootPackages = new Map<string, string | undefined>()
  const problems: SharedDependencyProblem[] = []
  for (const app of options.apps) {
    for (const name of app.sharedDependencies) {
      if (!rootPackages.has(name)) {
        rootPackages.set(name, findPackageDir(name, options.root.rootDir))
      }
      const root = rootPackages.get(name)
      const child = findPackageDir(name, app.rootDir)
      if (!root || !child || root !== child) problems.push({ name, app, root, child })
    }
  }
  if (problems.length > 0) throw new Error(problemMessage(options.root, problems))
}

/**
 * Find the real directory of an installed package the way Node looks up a bare specifier, from the
 * nearest `node_modules` directory upwards.
 *
 * Package exports are not consulted, so packages that export neither `.` nor `./package.json`,
 * such as subpath-only or type-only packages, are found as well.
 */
function findPackageDir(name: string, fromDir: string) {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name)
    // Node takes the first existing package directory; symbolic links of isolated installs count.
    if (statSync(candidate, { throwIfNoEntry: false })?.isDirectory()) {
      return realpathSync(candidate)
    }
    if (dirname(dir) === dir) return undefined
  }
}

function problemMessage(root: NormalizedAppOptions, problems: SharedDependencyProblem[]) {
  const lines = [
    "nuxt-multi-app: shared dependencies do not resolve to one installed copy.",
    "Each package in apps[].sharedDependencies must resolve to the same directory from the root application and from the child.",
  ]
  const location = (id: string, dir: string | undefined, from: string) =>
    `  ${id}: ${dir ?? `not installed (looked up from ${from})`}`
  for (const { name, app, root: rootDir, child } of problems) {
    lines.push(
      "",
      `${name} in app "${app.id}"`,
      location(`root "${root.id}"`, rootDir, root.rootDir),
      location(`child "${app.id}"`, child, app.rootDir),
    )
  }
  if (problems.some((problem) => problem.root && problem.child)) {
    lines.push(
      "",
      "Different directories mean the child was most likely installed separately from the root, for example by a package manager install run inside the child or by linking it to another checkout or worktree.",
      "The child's own code and code it imports from the root's directory would then load separate copies of these packages, each with its own state.",
      "Install the root and the child with one install of a shared workspace, and remove the installation the child got on its own.",
    )
  }
  if (problems.some((problem) => !problem.root || !problem.child)) {
    lines.push(
      "",
      "Install missing packages for the application they do not resolve from, or remove them from sharedDependencies of that child.",
    )
  }
  return lines.join("\n")
}
