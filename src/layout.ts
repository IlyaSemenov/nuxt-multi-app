import { isAbsolute, relative, sep } from "node:path"

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
