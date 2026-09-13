import type { IncomingMessage, ServerResponse } from "node:http"

import type { NuxtConfig } from "nuxt/schema"

export type AppOverrides = Omit<NuxtConfig, "buildDir" | "rootDir">

/** Configuration for the root Nuxt application that owns the public listener. */
export interface RootOptions {
  /** Stable registry ID used by routing and server-side dispatch; defaults to `root`. */
  id?: string
  /** Exact hosts or leading-wildcard host patterns served by this application. */
  hosts?: string[]
}

/** Configuration for an independently loaded Nuxt application. */
export interface AppOptions {
  /** Stable registry ID used by routing and server-side dispatch. */
  id: string
  /** Application root, resolved from the root application's directory. */
  rootDir: string
  /** Exact hosts or leading-wildcard host patterns served by this application. */
  hosts?: string[]
  /** Explicit mount-point configuration applied after the child's own configuration. */
  overrides?: AppOverrides
  /** Generated Nuxt directory, resolved from the child application's root. */
  buildDir?: string
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
) => string | false | undefined | Promise<string | false | undefined>

/** Values available while a project runtime extension is initialized at server startup. */
export interface MultiAppStartupContext {
  /** Every application ID accepted by routing and dispatch in configuration order. */
  appIds: ReadonlySet<string>
}

/** A project module factory that initializes one resolver before requests are accepted. */
export type MultiAppResolverFactory = (
  context: MultiAppStartupContext,
) => MultiAppResolver | Promise<MultiAppResolver>

/** A state-handler module renders failures and requests that have no application. */
export type MultiAppStateHandler = (
  state: MultiAppState,
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>

/** A project module factory that initializes one state handler before requests are accepted. */
export type MultiAppStateHandlerFactory = (
  context: MultiAppStartupContext,
) => MultiAppStateHandler | Promise<MultiAppStateHandler>

/** Directory the module owns inside a Nitro output or Nuxt build directory. */
export const MODULE_OUTPUT_DIR = "nuxt-multi-app"

/** Generated production entry, relative to the root Nitro output directory. */
export const PRODUCTION_ENTRY = `${MODULE_OUTPUT_DIR}/server.mjs`

/** Project modules bundled into generated output, keyed by their `ModuleOptions` field. */
export const PROJECT_MODULES = {
  resolver: { file: "resolver.mjs", name: "resolver" },
  stateHandler: { file: "state-handler.mjs", name: "state handler" },
} as const

export type ProjectModule = (typeof PROJECT_MODULES)[keyof typeof PROJECT_MODULES]

/** Values applied to every option the project leaves unset. */
export const MODULE_DEFAULTS = {
  root: { id: "root" },
  apps: [] as AppOptions[],
  buildDir: ".nuxt-multi-app",
  fallback: false,
  shutdownTimeout: 30_000,
} satisfies ModuleOptions

/** Configure the multi-application composition through `multiApp` in nuxt.config. */
export interface ModuleOptions {
  /** Configuration for the root Nuxt application that owns the listener. */
  root?: RootOptions
  /** Independently configured child applications. */
  apps?: AppOptions[]
  /** Generated Nuxt directory for mounted children, resolved from each child root. */
  buildDir?: string
  /** Application used when neither the resolver nor host patterns select one. */
  fallback?: string | false
  /** Path to a bundled module whose default export is a `MultiAppResolverFactory`. */
  resolver?: string
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
  hosts: string[]
  overrides: AppOverrides
  buildDir: string
  isRoot: boolean
}

/** Fully validated module configuration. */
export interface NormalizedModuleOptions {
  root: NormalizedAppOptions
  apps: NormalizedAppOptions[]
  allApps: NormalizedAppOptions[]
  fallback: string | false
  resolver?: string
  stateHandler?: string
  readinessPath: string | undefined
  shutdownTimeout: number
  debug: boolean
}
