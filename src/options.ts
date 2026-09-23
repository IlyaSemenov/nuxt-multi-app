import type { NuxtConfig } from "nuxt/schema"

import type { RoutingGuards, RoutingRule } from "./runtime/routing"

export type AppOverrides = Omit<NuxtConfig, "buildDir" | "rootDir">

/** Configuration for the root Nuxt application that owns the public listener. */
export interface RootOptions {
  /** Stable registry ID used by routing and server-side dispatch; defaults to `root`. */
  id?: string
}

/** Configuration for an independently loaded Nuxt application. */
export interface AppOptions {
  /** Stable registry ID used by routing and server-side dispatch. */
  id: string
  /** Application root, resolved from the root application's directory. */
  rootDir: string
  /** Explicit mount-point configuration applied after the child's own configuration. */
  overrides?: AppOverrides
}

/** One ordered routing rule that targets an application or invokes a project resolver. */
export type MultiAppRoutingRule =
  | (RoutingGuards & { app: string; resolver?: never })
  | (RoutingGuards & { resolver: string; app?: never })

/** Values applied to every option the project leaves unset. */
export const MODULE_DEFAULTS = {
  root: { id: "root" },
  apps: [] as AppOptions[],
  shutdownTimeout: 30_000,
} satisfies Omit<ModuleOptions, "routing">

/** Configure the multi-application composition through `multiApp` in nuxt.config. */
export interface ModuleOptions {
  /** Configuration for the root Nuxt application that owns the listener. */
  root?: RootOptions
  /** Independently configured child applications. */
  apps?: AppOptions[]
  /** Non-empty ordered first-match routing rules. */
  routing: MultiAppRoutingRule[]
  /** Path to a bundled module whose default export is a `MultiAppFallbackFactory`. */
  fallback?: string
  /** HTTP path that reports whether every Nuxt application is ready. */
  readinessPath?: string
  /** Maximum graceful-shutdown wait in milliseconds. */
  shutdownTimeout?: number
  /** Log routing and lifecycle details. Defaults to the `debug` option of the root application. */
  debug?: boolean
}

/** Fully resolved application configuration used by the module internals. */
export interface NormalizedAppOptions {
  id: string
  rootDir: string
  overrides: AppOverrides
  buildDir: string
  isRoot: boolean
}

/** A validated rule in configuration order, with its resolver module stored as an absolute path. */
export type NormalizedRoutingRule = RoutingRule<string>

/** Fully validated module configuration. */
export interface NormalizedModuleOptions {
  root: NormalizedAppOptions
  apps: NormalizedAppOptions[]
  allApps: NormalizedAppOptions[]
  routing: NormalizedRoutingRule[]
  fallback?: string
  readinessPath: string | undefined
  shutdownTimeout: number
  debug: boolean
}
