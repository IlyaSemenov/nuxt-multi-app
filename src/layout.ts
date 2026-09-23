import { isAbsolute, relative, resolve, sep } from "node:path"

const SERVER_DIR = "server"

/** Production entry, relative to the root Nitro output directory. */
export const PRODUCTION_ENTRY = `${SERVER_DIR}/index.mjs`

/**
 * Directory the module owns inside a Nuxt build directory.
 *
 * Its layout mirrors the root Nitro output directory, so `appDir()` and `serverDir()` apply to both.
 */
export function moduleBuildDir(buildDir: string) {
  return resolve(buildDir, "multi-app")
}

/**
 * Directory of one application in the root Nitro output directory or in `moduleBuildDir()`.
 *
 * Every application's Nitro output, the root's included, lands in `.output/apps/<id>`, and a mounted
 * child builds into `.nuxt/multi-app/apps/<id>`.
 */
export function appDir(baseDir: string, id: string) {
  return resolve(baseDir, "apps", id)
}

/** Directory of the production entry and of the bundled project modules it loads. */
export function serverDir(baseDir: string) {
  return resolve(baseDir, SERVER_DIR)
}

/** Bundled state-handler module inside `serverDir()`. */
export const STATE_HANDLER_FILE = "state-handler.mjs"

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
