import wsAdapter from "crossws/adapters/node"
import { defineNitroPlugin } from "nitropack/runtime"

import { createDevDispatch, createFetchFactory } from "./dispatch"
import type { NitroEvent, NitroRuntime, ProductionRuntime } from "./registry"
import { runtimeSymbol } from "./registry"
import type { NuxtMultiAppDispatch, NuxtMultiAppRequestContext } from "./types"

const appId = process.env.NUXT_MULTI_APP_ID!
const ids = JSON.parse(process.env.NUXT_MULTI_APP_IDS ?? "[]") as string[]
const gateway = JSON.parse(process.env.NUXT_MULTI_APP_GATEWAY ?? "null")
const token = process.env.NUXT_MULTI_APP_GATEWAY_TOKEN ?? ""

/** Inject the application identity and per-request dispatcher into every Nitro event. */
export default defineNitroPlugin((nitroValue) => {
  const nitro = nitroValue as unknown as NitroRuntime
  const production = (globalThis as Record<symbol, unknown>)[runtimeSymbol] as
    | ProductionRuntime
    | undefined
  if (production) {
    // Nitro creates `h3App.websocket` only when `experimental.websocket` is enabled.
    const upgrade = nitro.h3App?.websocket
      ? wsAdapter(nitro.h3App.websocket as never).handleUpgrade
      : undefined
    production.register(appId, nitro, upgrade)
  }

  const dispatch: NuxtMultiAppDispatch = production
    ? production.dispatch
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

/** Abort when the client disconnects, and also when the dispatching caller's signal aborts. */
function dispatchSignal(event: NitroEvent) {
  const platform = event.context._platform as
    | { nuxtMultiAppDispatchSignal?: AbortSignal }
    | undefined
  const propagated = platform?.nuxtMultiAppDispatchSignal
  const disconnected = new AbortController()
  const abort = () => disconnected.abort()
  event.node.req.once("aborted", abort)
  event.node.res.once("close", () => {
    if (!event.node.res.writableEnded) abort()
  })
  return propagated ? AbortSignal.any([propagated, disconnected.signal]) : disconnected.signal
}
