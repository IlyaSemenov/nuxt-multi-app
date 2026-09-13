/** Options for a server-side application dispatch. */
export interface NuxtMultiAppDispatchOptions {
  /** Cancellation signal propagated independently from `request.signal`. */
  signal?: AbortSignal
}

/** Dispatch an HTTP request to a known Nuxt application in the current composition. */
export type NuxtMultiAppDispatch = (
  appId: string,
  request: Request,
  options?: NuxtMultiAppDispatchOptions,
) => Promise<Response>

/** Platform `fetch` bound to one application in the composition. */
export type NuxtMultiAppFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** Bind `fetch` to an application for clients that take a `fetch` implementation. */
export type NuxtMultiAppCreateFetch = (
  appId: string,
  options?: NuxtMultiAppDispatchOptions,
) => NuxtMultiAppFetch

/** Per-request multi-application handle injected into every Nitro event. */
export interface NuxtMultiAppRequestContext {
  /** ID of the application handling the current request. */
  appId: string
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
