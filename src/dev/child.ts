import type { Buffer } from "node:buffer"
import type { RequestListener, Server } from "node:http"
import type { Duplex } from "node:stream"

import { buildNuxt, writeTypes } from "@nuxt/kit"
import type { Nuxt } from "nuxt/schema"

import { logger } from "../logger"
import {
  getDevHandler,
  getDevUpgrade,
  inlineViteBridge,
  watchChildConfig,
  withGlobalNuxtContext,
} from "../nuxt/compat"
import { loadChildNuxt } from "../nuxt/load-child"
import type { NormalizedAppOptions } from "../options"
import type { GatewayAddress } from "../runtime/dispatch"
import type { MultiAppFallbackReason, MultiAppFallback } from "../runtime/fallback"
import { setupHmr } from "./hmr"
import type { DevEndpointState } from "./routing"

/** The root instance and composition-wide services a mounted child is created with. */
export interface ChildContext {
  root: Nuxt
  ids: string[]
  gateway: { address: GatewayAddress; token: string; invalidate(id: string): void }
  fallback: MultiAppFallback
  debug: boolean
}

/** Load and own one child Nuxt lifecycle without inheriting the root configuration. */
export function createChild(
  options: NormalizedAppOptions,
  { root, ids, gateway, fallback, debug }: ChildContext,
) {
  const log = logger.withTag(options.id)
  let nuxt: Nuxt | undefined
  let hmr: ReturnType<typeof setupHmr> | undefined
  let handler: RequestListener | undefined
  let appUpgrade: ReturnType<typeof getDevUpgrade>
  let starting: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let state: DevEndpointState = { type: "starting" }

  async function start(server: Server) {
    nuxt = await loadChildNuxt(
      options,
      { type: "dev", devServer: root.options.devServer },
      { ids, gateway: gateway.address, token: gateway.token },
    )
    if (closing) return
    nuxt.hook("nitro:init", (nitro) => {
      nitro.hooks.hook("dev:reload", () => gateway.invalidate(options.id))
    })
    inlineViteBridge(nuxt, options.id)
    hmr = setupHmr(nuxt, options.id)
    hmr.attach(server)
    // A watcher from the retiring generation must not restart the root again during teardown.
    nuxt.hook("restart", (options) => {
      if (!closing) return root.callHook("restart", options)
    })
    // Only loading claims the global context: once the application is mounted it serves requests
    // through its own async context, and the root owns the global one again.
    await withGlobalNuxtContext(nuxt, async (nuxt) => {
      await nuxt.ready()
      if (closing) return
      watchChildConfig(nuxt)
      await nuxt.runWithContext(() => writeTypes(nuxt))
      await buildNuxt(nuxt)
    })
    if (closing) return
    handler = getDevHandler(nuxt)
    appUpgrade = getDevUpgrade(nuxt)
    state = { type: "ready" }
    log.info(`mounted ${options.rootDir}`)
  }

  return {
    id: options.id,
    get state() {
      return state
    },
    start(server: Server) {
      if (closing) return Promise.resolve()
      return (starting ??= start(server).catch((error) => {
        if (!closing) state = { type: "failed", error }
        log.error(error)
        throw error
      }))
    },
    handle: (async (request, response) => {
      if (state.type === "ready" && handler) return handler(request, response)
      const reason: MultiAppFallbackReason =
        state.type === "failed"
          ? { type: "failed", appId: options.id, error: state.error }
          : state.type === "closing"
            ? { type: "closing", appId: options.id }
            : { type: "starting", appId: options.id }
      return fallback(reason, request, response)
    }) satisfies RequestListener,
    async upgrade(request: Parameters<RequestListener>[0], socket: Duplex, head: Buffer) {
      if (state.type !== "ready") {
        socket.destroy()
        return
      }
      if (request.headers["sec-websocket-protocol"] === "vite-hmr") {
        if (debug) log.info(`HMR upgrade ${request.url}`)
        hmr!.upgrade(request, socket, head)
        return
      }
      if (appUpgrade) await appUpgrade(request, socket, head)
      else socket.destroy()
    },
    close() {
      if (closing) return closing
      state = { type: "closing" }
      // Let Nuxt release its watcher, Nitro worker and Vite servers in their registered order.
      return (closing = (async () => {
        await starting?.catch(() => undefined)
        await nuxt?.close()
        log.info("closed")
      })())
    },
  }
}

/** A mounted child in development, addressed by the dev router and the dispatch gateway. */
export type Child = ReturnType<typeof createChild>
