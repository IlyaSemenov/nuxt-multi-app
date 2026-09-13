import { existsSync, realpathSync } from "node:fs"
import { resolve } from "node:path"

import type { Nuxt } from "nuxt/schema"

import type {
  AppOptions,
  ModuleOptions,
  NormalizedAppOptions,
  NormalizedModuleOptions,
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
    hosts: normalizeHosts(options.root?.hosts ?? []),
    overrides: {},
    buildDir: nuxt.options.buildDir,
    isRoot: true,
  }

  const ids = new Set([rootId])
  const roots = new Set([rootDir])
  const buildDirs = new Set([resolve(nuxt.options.buildDir)])
  const apps = (options.apps ?? MODULE_DEFAULTS.apps).map((app) => {
    assertId(app.id)
    if (ids.has(app.id)) throw new Error(`nuxt-multi-app: duplicate application id ${app.id}`)
    ids.add(app.id)

    const normalized = normalizeApp(app, rootDir)
    if (!existsSync(normalized.rootDir)) {
      throw new Error(`nuxt-multi-app: application root does not exist: ${normalized.rootDir}`)
    }
    const realRoot = realpathSync(normalized.rootDir)
    if (roots.has(realRoot)) {
      throw new Error(`nuxt-multi-app: application root is mounted more than once: ${realRoot}`)
    }
    roots.add(realRoot)
    normalized.rootDir = realRoot
    normalized.buildDir = app.buildDir
      ? resolve(realRoot, app.buildDir)
      : resolve(realRoot, options.buildDir ?? MODULE_DEFAULTS.buildDir, app.id)
    if (buildDirs.has(normalized.buildDir)) {
      throw new Error(
        `nuxt-multi-app: buildDir is shared by multiple applications: ${normalized.buildDir}`,
      )
    }
    buildDirs.add(normalized.buildDir)
    return normalized
  })

  const fallback = options.fallback ?? MODULE_DEFAULTS.fallback
  if (fallback !== false && !ids.has(fallback)) {
    throw new Error(`nuxt-multi-app: fallback references unknown application ${fallback}`)
  }

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

  const resolver = resolveModulePath(options.resolver, rootDir)
  const stateHandler = resolveModulePath(options.stateHandler, rootDir)

  return {
    root,
    apps,
    allApps: [root, ...apps],
    fallback,
    resolver,
    stateHandler,
    readinessPath,
    shutdownTimeout,
    debug: options.debug ?? Boolean(nuxt.options.debug),
  }
}

function normalizeApp(app: AppOptions, rootDir: string): NormalizedAppOptions {
  const appRootDir = resolve(rootDir, app.rootDir)
  return {
    id: app.id,
    rootDir: appRootDir,
    hosts: normalizeHosts(app.hosts ?? []),
    overrides: app.overrides ?? {},
    buildDir: "",
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

function resolveModulePath(path: string | undefined, rootDir: string) {
  if (!path) return undefined
  const resolved = resolve(rootDir, path)
  if (!existsSync(resolved)) throw new Error(`nuxt-multi-app: module does not exist: ${resolved}`)
  return resolved
}
