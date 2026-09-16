/** Application registry augmented by the declarations generated for a Nuxt project. */
export interface NuxtMultiAppRegistry {}

/** Configured application ID, or any string before generated project types are available. */
export type AppId = keyof NuxtMultiAppRegistry extends never
  ? string
  : Extract<NuxtMultiAppRegistry[keyof NuxtMultiAppRegistry], string>

/** Options for a server-side application dispatch. */
export interface NuxtMultiAppDispatchOptions {
  /** Cancellation signal propagated independently from `request.signal`. */
  signal?: AbortSignal
}

/** Options for a `fetch` implementation bound to one application. */
export interface NuxtMultiAppCreateFetchOptions extends NuxtMultiAppDispatchOptions {
  /** Incoming request headers to inherit when the final Request does not contain them. */
  inheritRequestHeaders?: readonly string[]
}

/** Dispatch an HTTP request to a known Nuxt application in the current composition. */
export type NuxtMultiAppDispatch = (
  appId: AppId,
  request: Request,
  options?: NuxtMultiAppDispatchOptions,
) => Promise<Response>

/** Platform `fetch` bound to one application in the composition. */
export type NuxtMultiAppFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Bind `fetch` to an application for clients that take a `fetch` implementation. */
export type NuxtMultiAppCreateFetch = (
  appId: AppId,
  options?: NuxtMultiAppCreateFetchOptions,
) => NuxtMultiAppFetch

/** Per-request multi-application handle injected into every Nitro event. */
export interface NuxtMultiAppRequestContext {
  /** ID of the application handling the current request. */
  appId: AppId
  /** Signal aborted when an internal caller disconnects or production shutdown begins. */
  signal: AbortSignal
  /** Address another application by registry ID without a public TCP round trip. */
  dispatch: NuxtMultiAppDispatch
  /** Bind `fetch` to another application, for clients configured with a `fetch` implementation. */
  createFetch: NuxtMultiAppCreateFetch
}

declare module "h3" {
  interface H3EventContext {
    nuxtMultiApp: NuxtMultiAppRequestContext
  }
}
