import type { IncomingMessage, ServerResponse } from "node:http"

import type { NuxtConfig } from "nuxt/schema"

import type { AppId } from "./runtime/types"

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

/** State passed to the optional state-handler module. */
export type MultiAppState =
  | { type: "unmatched"; host: string }
  | { type: "starting"; appId: string }
  | { type: "closing"; appId: string }
  | { type: "failed"; appId: string; error: unknown }
  | { type: "resolver-error"; error: unknown }

/** Choose an application, continue with static routing, or force an unmatched response. */
export type MultiAppResolver = (
  host: string,
  request: IncomingMessage,
) => AppId | false | undefined | Promise<AppId | false | undefined>

/** A project module factory that initializes one resolver before requests are accepted. */
export type MultiAppResolverFactory = () => MultiAppResolver | Promise<MultiAppResolver>

interface MultiAppRoutingGuards {
  /** Exact hosts or leading-wildcard host patterns, matched with OR semantics. */
  hosts?: string[]
  /** Absolute path prefixes, matched with OR semantics at segment boundaries. */
  paths?: string[]
}

/** One ordered routing rule that targets an application or invokes a project resolver. */
export type MultiAppRoutingRule =
  | (MultiAppRoutingGuards & { app: string; resolver?: never })
  | (MultiAppRoutingGuards & { resolver: string; app?: never })

/** A state-handler module renders failures and requests that have no application. */
export type MultiAppStateHandler = (
  state: MultiAppState,
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>

/** A project module factory that initializes one state handler before requests are accepted. */
export type MultiAppStateHandlerFactory = () => MultiAppStateHandler | Promise<MultiAppStateHandler>

/** Directory the module owns inside a Nitro output or Nuxt build directory. */
export const MODULE_OUTPUT_DIR = "nuxt-multi-app"

/** Generated production entry, relative to the root Nitro output directory. */
export const PRODUCTION_ENTRY = "server/index.mjs"

/** Project modules bundled into generated output, keyed by their `ModuleOptions` field. */
export const PROJECT_MODULES = {
  stateHandler: { file: "state-handler.mjs", name: "state handler" },
} as const satisfies Record<string, ProjectModule>

/** Generated filename and diagnostic label for one bundled project module. */
export interface ProjectModule {
  file: string
  name: string
}

/** Describe the generated module for a resolver at one routing-list index. */
export function resolverProjectModule(index: number): ProjectModule {
  return { file: `resolver-${index + 1}.mjs`, name: `resolver in routing rule ${index + 1}` }
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

/** A validated routing rule that selects an application. */
export interface NormalizedAppRoutingRule {
  app: string
  hosts?: string[]
  paths?: string[]
}

/** A validated routing rule whose resolver module is stored as an absolute path. */
export interface NormalizedResolverRoutingRule {
  resolver: string
  hosts?: string[]
  paths?: string[]
}

/** A validated rule in configuration order. */
export type NormalizedRoutingRule = NormalizedAppRoutingRule | NormalizedResolverRoutingRule

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
