import wsAdapter from "crossws/adapters/node"
import { defineNitroPlugin } from "nitropack/runtime"

import { createDevDispatch, createFetchFactory } from "./dispatch"
import type { NuxtMultiAppDispatch, NuxtMultiAppRequestContext } from "./types"

interface NitroRuntime {
  hooks: { hook(name: string, handler: (event: NitroEvent) => unknown): void }
  h3App?: { websocket?: unknown }
  localFetch(input: string, init?: Record<string, unknown>): Promise<Response>
}

interface NitroEvent {
  context: Record<string, unknown>
  node: {
    req: NodeJS.EventEmitter
    res: NodeJS.EventEmitter & { writableEnded?: boolean }
  }
}

interface ProductionRuntime {
  register(appId: string, nitro: NitroRuntime, upgrade?: (...args: unknown[]) => unknown): void
  dispatch(
    callerId: string,
    targetId: string,
    request: Request,
    options?: { signal?: AbortSignal },
  ): Promise<Response>
}

const appId = process.env.NUXT_MULTI_APP_ID!
const ids = JSON.parse(process.env.NUXT_MULTI_APP_IDS ?? "[]") as string[]
const gateway = JSON.parse(process.env.NUXT_MULTI_APP_GATEWAY ?? "null")
const token = process.env.NUXT_MULTI_APP_GATEWAY_TOKEN ?? ""
// The production entry installs this registry before importing any application bundle.
const runtimeSymbol = Symbol.for("nuxt-multi-app.runtime")

/** Inject the application identity and per-request dispatcher into every Nitro event. */
export default defineNitroPlugin((nitroValue) => {
  const nitro = nitroValue as unknown as NitroRuntime
  const production = (globalThis as Record<symbol, unknown>)[runtimeSymbol] as
    | ProductionRuntime
    | undefined
  const websocket = nitro.h3App?.websocket
    ? wsAdapter(nitro.h3App.websocket as never).handleUpgrade
    : undefined
  if (production) production.register(appId, nitro, websocket as never)

  const dispatch: NuxtMultiAppDispatch = production
    ? (targetId, request, options) => production.dispatch(appId, targetId, request, options)
    : createDevDispatch(appId, ids, nitro, gateway, token)

  nitro.hooks.hook("request", (event) => {
    const signal = dispatchSignal(event)
    event.context.nuxtMultiApp = {
      appId,
      signal,
      dispatch,
      createFetch: createFetchFactory(dispatch, signal),
    } satisfies NuxtMultiAppRequestContext
  })
})

function dispatchSignal(event: NitroEvent) {
  const platform = event.context._platform as
    | { nuxtMultiAppDispatchSignal?: AbortSignal }
    | undefined
  const propagated =
    (event.context.nuxtMultiAppDispatchSignal as AbortSignal | undefined) ??
    platform?.nuxtMultiAppDispatchSignal
  const disconnected = new AbortController()
  const abort = () => disconnected.abort()
  event.node.req.once("aborted", abort)
  event.node.res.once("close", () => {
    if (!event.node.res.writableEnded) abort()
  })
  return propagated ? AbortSignal.any([propagated, disconnected.signal]) : disconnected.signal
}
