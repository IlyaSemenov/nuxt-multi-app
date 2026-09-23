import type { NuxtConfig } from "nuxt/schema"

import { resolverLabel, type RoutingGuards, type RoutingRule } from "./runtime/routing"
import { STATE_HANDLER_LABEL } from "./runtime/state"

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

/** Directory the module owns inside a Nitro output or Nuxt build directory. */
export const MODULE_OUTPUT_DIR = "nuxt-multi-app"

/** Generated production entry, relative to the root Nitro output directory. */
export const PRODUCTION_ENTRY = "server/index.mjs"

/** Project modules bundled into generated output, keyed by their `ModuleOptions` field. */
export const PROJECT_MODULES = {
  stateHandler: { file: "state-handler.mjs", name: STATE_HANDLER_LABEL },
} as const satisfies Record<string, ProjectModule>

/** Generated filename and diagnostic label for one bundled project module. */
export interface ProjectModule {
  file: string
  name: string
}

/** Describe the generated module for a resolver at one routing-list index. */
export function resolverProjectModule(index: number): ProjectModule {
  return { file: `resolver-${index + 1}.mjs`, name: resolverLabel(index) }
}

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
  /** Path to a bundled module whose default export is a `MultiAppStateHandlerFactory`. */
  stateHandler?: string
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
  stateHandler?: string
  readinessPath: string | undefined
  shutdownTimeout: number
  debug: boolean
}
