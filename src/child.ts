import type { Buffer } from "node:buffer"
import type { RequestListener, Server } from "node:http"
import type { Duplex } from "node:stream"

import { buildNuxt, loadNuxt, writeTypes } from "@nuxt/kit"
import type { Nuxt } from "nuxt/schema"

import { getDevHandler, getDevUpgrade, setupDevAdapter, watchChildConfig } from "./compat"
import { configureNuxtApp } from "./configure-app"
import type { GatewayAddress } from "./gateway"
import { logger } from "./logger"
import type { MultiAppState, MultiAppStateHandler, NormalizedAppOptions } from "./options"
import { childOverrides } from "./overrides"

export type ChildState =
  | { type: "starting" }
  | { type: "ready" }
  | { type: "failed"; error: unknown }
  | { type: "closing" }

/** Load and own one child Nuxt lifecycle without inheriting the root configuration. */
export function createChild(
  options: NormalizedAppOptions,
  root: Nuxt,
  ids: string[],
  gateway: { address: GatewayAddress; token: string; invalidate(id: string): void },
  stateHandler: MultiAppStateHandler,
  debug: boolean,
) {
  const log = logger.withTag(options.id)
  let nuxt: Nuxt | undefined
  let adapter: ReturnType<typeof setupDevAdapter> | undefined
  let handler: RequestListener | undefined
  let appUpgrade: ReturnType<typeof getDevUpgrade>
  let starting: Promise<void> | undefined
  let closing: Promise<void> | undefined
  let state: ChildState = { type: "starting" }

  async function start(server: Server) {
    nuxt = await loadNuxt({
      cwd: options.rootDir,
      dev: true,
      ready: false,
      dotenv: false,
      overrides: childOverrides(options, root.options.devServer),
    })
    if (closing) return
    configureNuxtApp(nuxt, options, { ids, gateway: gateway.address, token: gateway.token })
    nuxt.hook("nitro:init", (nitro) => {
      nitro.hooks.hook("dev:reload", () => gateway.invalidate(options.id))
    })
    adapter = setupDevAdapter(nuxt, options.id)
    adapter.attach(server)
    // A watcher from the retiring generation must not restart the root again during teardown.
    nuxt.hook("restart", (options) => {
      if (!closing) return root.callHook("restart", options)
    })
    await nuxt.ready()
    if (closing) return
    watchChildConfig(nuxt)
    await nuxt.runWithContext(() => writeTypes(nuxt!))
    await buildNuxt(nuxt)
    if (closing) return
    handler = getDevHandler(nuxt)
    appUpgrade = getDevUpgrade(nuxt)
    state = { type: "ready" }
    log.info(`mounted ${options.rootDir}`)
  }

  return {
    id: options.id,
    options,
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
      const publicState: MultiAppState =
        state.type === "failed"
          ? { type: "failed", appId: options.id, error: state.error }
          : state.type === "closing"
            ? { type: "closing", appId: options.id }
            : { type: "starting", appId: options.id }
      return stateHandler(publicState, request, response)
    }) satisfies RequestListener,
    async upgrade(request: Parameters<RequestListener>[0], socket: Duplex, head: Buffer) {
      if (state.type !== "ready") {
        socket.destroy()
        return
      }
      if (request.headers["sec-websocket-protocol"] === "vite-hmr") {
        if (debug) log.info(`HMR upgrade ${request.url}`)
        adapter!.upgrade(request, socket, head)
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
