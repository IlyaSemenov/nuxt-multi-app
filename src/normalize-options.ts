import { existsSync, realpathSync } from "node:fs"
import { resolve } from "node:path"

import type { Nuxt } from "nuxt/schema"

import { logger } from "./logger"
import type {
  AppOptions,
  ModuleOptions,
  NormalizedAppOptions,
  NormalizedModuleOptions,
  NormalizedRoutingRule,
} from "./options"
import { MODULE_DEFAULTS } from "./options"

const ID_PATTERN = /^[a-z0-9-]+$/

/** Validate and resolve every path before any additional Nuxt instance is loaded. */
export function normalizeOptions(options: ModuleOptions, nuxt: Nuxt): NormalizedModuleOptions {
  const rootDir = realpathSync(nuxt.options.rootDir)
  const rootId = options.root?.id ?? MODULE_DEFAULTS.root.id
  assertId(rootId)

  const root: NormalizedAppOptions = {
    id: rootId,
    rootDir,
    overrides: {},
    buildDir: nuxt.options.buildDir,
    isRoot: true,
  }

  const ids = new Set([rootId])
  const roots = new Set([rootDir])
  const rootBuildDir = resolve(nuxt.options.buildDir)
  const buildDirs = new Set([rootBuildDir])
  const apps = (options.apps ?? MODULE_DEFAULTS.apps).map((app) => {
    assertId(app.id)
    if (ids.has(app.id)) throw new Error(`nuxt-multi-app: duplicate application id ${app.id}`)
    ids.add(app.id)

    const normalized = normalizeApp(app, rootDir, rootBuildDir)
    if (roots.has(normalized.rootDir)) {
      throw new Error(
        `nuxt-multi-app: application root is mounted more than once: ${normalized.rootDir}`,
      )
    }
    roots.add(normalized.rootDir)
    if (buildDirs.has(normalized.buildDir)) {
      throw new Error(
        `nuxt-multi-app: buildDir is shared by multiple applications: ${normalized.buildDir}`,
      )
    }
    buildDirs.add(normalized.buildDir)
    return normalized
  })
  const routing = normalizeRouting(options.routing, ids, rootDir)

  const readinessPath = options.readinessPath
  if (
    readinessPath !== undefined &&
    (!readinessPath.startsWith("/") || readinessPath.includes("?"))
  ) {
    throw new Error("nuxt-multi-app: readinessPath must be an absolute path without a query")
  }

  const shutdownTimeout = options.shutdownTimeout ?? MODULE_DEFAULTS.shutdownTimeout
  if (!Number.isSafeInteger(shutdownTimeout) || shutdownTimeout <= 0) {
    throw new Error("nuxt-multi-app: shutdownTimeout must be a positive integer")
  }

  return {
    root,
    apps,
    allApps: [root, ...apps],
    routing,
    stateHandler: resolveModulePath(options.stateHandler, rootDir),
    readinessPath,
    shutdownTimeout,
    debug: options.debug ?? Boolean(nuxt.options.debug),
  }
}

/** Resolve one child's directories, following root symlinks so duplicate mounts are detected. */
function normalizeApp(
  app: AppOptions,
  rootDir: string,
  rootBuildDir: string,
): NormalizedAppOptions {
  const requestedRoot = resolve(rootDir, app.rootDir)
  if (!existsSync(requestedRoot)) {
    throw new Error(`nuxt-multi-app: application root does not exist: ${requestedRoot}`)
  }
  const appRootDir = realpathSync(requestedRoot)
  return {
    id: app.id,
    rootDir: appRootDir,
    overrides: app.overrides ?? {},
    buildDir: resolve(rootBuildDir, "multi-app", app.id),
    isRoot: false,
  }
}

function assertId(id: string) {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`nuxt-multi-app: invalid application id ${id}`)
  }
}

function normalizeHosts(hosts: string[]) {
  return hosts.map((input) => {
    const host = input.toLowerCase().replace(/\.$/, "")
    if (!host || host.includes(":") || (host.includes("*") && !/^\*\.[^*]+$/.test(host))) {
      throw new Error(`nuxt-multi-app: invalid host pattern ${input}`)
    }
    return host
  })
}

function normalizePaths(paths: string[]) {
  return paths.map((input) => {
    if (
      !input.startsWith("/") ||
      input.startsWith("//") ||
      input.includes("?") ||
      input.includes("#") ||
      input.includes("\\") ||
      input.split("/").some((segment) => segment === "." || segment === "..")
    ) {
      throw new Error(`nuxt-multi-app: invalid path prefix ${input}`)
    }
    return input.replace(/\/+$/, "") || "/"
  })
}

/** Validate routing as one explicit first-match program. */
function normalizeRouting(
  input: ModuleOptions["routing"] | undefined,
  ids: Set<string>,
  rootDir: string,
): NormalizedRoutingRule[] {
  if (input === undefined) throw new Error("nuxt-multi-app: routing is required")
  if (input.length === 0) throw new Error("nuxt-multi-app: routing must not be empty")

  const routing = input.map((rule, index): NormalizedRoutingRule => {
    const hasApp = typeof rule.app === "string"
    const hasResolver = typeof rule.resolver === "string"
    if (hasApp === hasResolver) {
      throw new Error(
        `nuxt-multi-app: routing rule ${index + 1} must define exactly one of app or resolver`,
      )
    }
    const hosts = normalizeGuard(rule.hosts, normalizeHosts, "hosts", index)
    const paths = normalizeGuard(rule.paths, normalizePaths, "paths", index)
    if (hasApp) {
      if (!ids.has(rule.app!)) {
        throw new Error(
          `nuxt-multi-app: routing rule ${index + 1} references unknown application ${rule.app}`,
        )
      }
      if (!hosts && !paths && index !== input.length - 1) {
        throw new Error(
          `nuxt-multi-app: unconditional routing rule ${index + 1} must be the last rule`,
        )
      }
      return { app: rule.app!, hosts, paths }
    }
    return { resolver: resolveModulePath(rule.resolver, rootDir)!, hosts, paths }
  })

  if (!routing.some((rule) => "resolver" in rule)) {
    const referenced = new Set(routing.flatMap((rule) => ("app" in rule ? [rule.app] : [])))
    for (const id of ids) {
      if (!referenced.has(id))
        logger.warn(`application ${id} is not referenced by any routing rule`)
    }
  }
  return routing
}

function normalizeGuard(
  input: string[] | undefined,
  normalize: (values: string[]) => string[],
  field: string,
  index: number,
) {
  if (input === undefined) return undefined
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error(`nuxt-multi-app: routing rule ${index + 1} ${field} must not be empty`)
  }
  return normalize(input)
}

function resolveModulePath(path: string | undefined, rootDir: string) {
  if (!path) return undefined
  const resolved = resolve(rootDir, path)
  if (!existsSync(resolved)) throw new Error(`nuxt-multi-app: module does not exist: ${resolved}`)
  return resolved
}
