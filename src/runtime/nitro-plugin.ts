import wsAdapter from "crossws/adapters/node"
import { defineNitroPlugin } from "nitropack/runtime"

import { getProductionRuntime, type NitroEvent, type NitroRuntime } from "./contract"
import { createDevDispatch, createFetchFactory, createPrerenderDispatch } from "./dispatch"
import type { NuxtMultiAppDispatch, NuxtMultiAppRequestContext } from "./types"
import { installWorkerProbe } from "./worker-probe"

const appId = process.env.NUXT_MULTI_APP_ID!
const ids = JSON.parse(process.env.NUXT_MULTI_APP_IDS ?? "[]") as string[]
const gateway = JSON.parse(process.env.NUXT_MULTI_APP_GATEWAY ?? "null")
const token = process.env.NUXT_MULTI_APP_GATEWAY_TOKEN ?? ""

/** Inject the application identity and per-request dispatcher into every Nitro event. */
export default defineNitroPlugin((nitroValue) => {
  const nitro = nitroValue as unknown as NitroRuntime
  // Nitro replaces these flags per bundle, so a production bundle never takes another branch.
  let dispatch: NuxtMultiAppDispatch
  if (import.meta.dev) {
    installWorkerProbe(nitroValue.h3App, token)
    dispatch = createDevDispatch(appId, ids, nitro, gateway, token)
  } else if (import.meta.prerender) {
    dispatch = createPrerenderDispatch(appId, ids, nitro)
  } else {
    dispatch = registerProductionRuntime(nitro)
  }

  nitro.hooks.hook("request", (event) => {
    const signal = dispatchSignal(event)
    event.context.nuxtMultiApp = {
      appId,
      signal,
      dispatch,
      createFetch: createFetchFactory(dispatch, signal, event.node.req.headers, event.node.res),
    } satisfies NuxtMultiAppRequestContext
  })
})

/** Register this bundle with the production entry, which must have installed its registry first. */
function registerProductionRuntime(nitro: NitroRuntime): NuxtMultiAppDispatch {
  const production = getProductionRuntime()
  if (!production) {
    // The entry captures each bundle's Nitro globals around its own import, so a bundle evaluated
    // earlier cannot be attached to the composition afterwards.
    throw new Error(
      `nuxt-multi-app: the Nitro bundle of ${appId} was evaluated before the production entry installed its runtime; ` +
        "start the server with server/index.mjs in the root application's build output and keep preloaded modules, such as `node --import` files, free of application server chunks",
    )
  }
  // Nitro creates `h3App.websocket` only when `experimental.websocket` is enabled.
  const upgrade = nitro.h3App?.websocket
    ? wsAdapter(nitro.h3App.websocket as never).handleUpgrade
    : undefined
  production.register(appId, nitro, upgrade)
  return production.dispatch
}

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
