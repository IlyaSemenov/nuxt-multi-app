import { createHash } from "node:crypto"
import { isAbsolute, relative, resolve, sep } from "node:path"

const SERVER_DIR = "server"

/** Production entry, relative to the root Nitro output directory. */
export const PRODUCTION_ENTRY = `${SERVER_DIR}/index.mjs`

/**
 * Directory the module owns inside the root Nuxt build directory.
 *
 * Like the root Nitro output directory, it holds bundled project modules under `serverDir()`.
 */
export function moduleBuildDir(buildDir: string) {
  return resolve(buildDir, "multi-app")
}

/**
 * Directory of one application in the root Nitro output directory.
 *
 * Every application's Nitro output, the root's included, lands in `.output/apps/<id>`.
 */
export function appDir(baseDir: string, id: string) {
  return resolve(baseDir, "apps", id)
}

/**
 * Build directory of a mounted child, inside the child's own tree.
 *
 * Generated files import packages by bare specifiers, so they must resolve from the child's
 * dependencies, as in a standalone run, even when the root is installed separately.
 * The directory lives in `.nuxt/cache`, which tools ignore with `.nuxt` and which the Nuxt CLI keeps
 * when it clears the child's standalone build; `node_modules` would hide the generated TypeScript
 * projects' files from their own `include` patterns.
 * The directory is keyed by the root's build directory, so every root that mounts the same child,
 * such as one per worktree, gets its own copy.
 */
export function mountedBuildDir(childRootDir: string, rootId: string, rootBuildDir: string) {
  const rootKey = createHash("sha256").update(resolve(rootBuildDir)).digest("hex").slice(0, 12)
  return resolve(childRootDir, ".nuxt/cache/nuxt-multi-app", `${rootId}-${rootKey}`)
}

/** Directory of the production entry and of the bundled project modules it loads. */
export function serverDir(baseDir: string) {
  return resolve(baseDir, SERVER_DIR)
}

/** Bundled fallback module inside `serverDir()`. */
export const FALLBACK_FILE = "fallback.mjs"

/** Bundled resolver module of one routing rule inside `serverDir()`. */
export function resolverFile(index: number) {
  return `resolver-${index + 1}.mjs`
}

/** TypeScript solution the root build directory holds for every application in the composition. */
export const TYPECHECK_SOLUTION = "tsconfig.multi-app.json"

/**
 * Express `to` relative to `from` with forward slashes and an explicit `./` prefix, as ESM
 * specifiers and tsconfig references require on every platform.
 *
 * A target on another Windows drive has no relative form and is returned as an absolute path.
 */
export function relativePath(from: string, to: string) {
  const path = relative(from, to).split(sep).join("/")
  // A leading dot alone is not enough: `.cache/x` would still be a bare ESM specifier.
  return isAbsolute(path) || /^\.\.?(?:\/|$)/.test(path) ? path : `./${path}`
}
