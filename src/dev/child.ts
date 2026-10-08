import type { Buffer } from "node:buffer"
import type { RequestListener, Server } from "node:http"
import type { Duplex } from "node:stream"
import { setTimeout } from "node:timers/promises"

import { buildNuxt, writeTypes } from "@nuxt/kit"
import type { Nuxt } from "nuxt/schema"

import { logger } from "../logger"
import {
  getDevHandler,
  getDevUpgrade,
  getDevWorkerHandler,
  inlineViteBridge,
  watchChildConfig,
  withGlobalNuxtContext,
} from "../nuxt/compat"
import { loadChildNuxt } from "../nuxt/load-child"
import type { NormalizedAppOptions } from "../options"
import { gatewayFetch, type GatewayAddress } from "../runtime/dispatch"
import type { MultiAppFallbackReason, MultiAppFallback } from "../runtime/fallback"
import { WORKER_PROBE_HEADER } from "../runtime/worker-probe"
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
  let probeHandler: RequestListener | undefined
  let appUpgrade: ReturnType<typeof getDevUpgrade>
  let starting: Promise<void> | undefined
  const stopBuild = Promise.withResolvers<void>()
  let closing: Promise<void> | undefined
  let mounting: Promise<void> | undefined
  let probeController: AbortController | undefined
  let state: DevEndpointState = { type: "starting" }
  // Settles whenever the child leaves the starting state: it mounted, failed or began closing.
  // Requests that arrive meanwhile wait for it: in production an application never serves before it loads,
  // and a caller such as server-side rendering cannot retry a dispatch on its own.
  let leftStarting = Promise.withResolvers<void>()
  // Compilation and worker startup failures can recover on the next compilation.
  let retryOnCompile = false

  /** Change the endpoint state and release requests waiting for the preceding startup attempt. */
  function setState(next: DevEndpointState) {
    if (next.type === "starting" && state.type !== "starting")
      leftStarting = Promise.withResolvers()
    state = next
    if (next.type !== "starting") leftStarting.resolve()
  }

  async function start(server: Server) {
    nuxt = await loadChildNuxt(
      options,
      { type: "dev", devServer: root.options.devServer },
      { ids, gateway: gateway.address, token: gateway.token },
    )
    if (closing) return
    nuxt.hook("nitro:init", (nitro) => {
      nitro.hooks.hook("dev:reload", () => {
        // Builds that load the child end nothing: calls held until it loads have not reached a worker yet.
        if (state.type === "ready") gateway.invalidate(options.id)
        else if (probeHandler && !closing) mount()
      })
      // Nuxt keeps waiting for the first successful Nitro compilation, so a compilation error would otherwise
      // hold requests until the sources are fixed; answer them with the failure meanwhile.
      nitro.hooks.hook("dev:error", (error) => {
        if (closing) {
          stopBuild.resolve()
          return
        }
        if (state.type !== "starting") return
        probeController?.abort()
        retryOnCompile = true
        setState({ type: "failed", error })
      })
      nitro.hooks.hook("dev:start", () => {
        if (state.type !== "ready") probeController?.abort()
        if (state.type === "failed" && retryOnCompile) setState({ type: "starting" })
      })
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
      // A failed first compilation leaves Nuxt's build pending until the source is fixed.
      // Shutdown may stop waiting after that failure, then close Nuxt's registered resources.
      await Promise.race([buildNuxt(nuxt), stopBuild.promise])
    })
    if (closing) return
    handler = getDevHandler(nuxt)
    probeHandler = getDevWorkerHandler(nuxt)
    appUpgrade = getDevUpgrade(nuxt)
    // Release the load queue before waiting for this worker, so other applications can start.
    mount()
  }

  /** Observe only the current worker; a replacement or close cancels the preceding probe. */
  function mount() {
    if (closing || state.type !== "starting") return
    probeController?.abort()
    const controller = (probeController = new AbortController())
    mounting = waitForWorker(controller.signal)
      .then(() => {
        if (controller.signal.aborted) return
        retryOnCompile = false
        setState({ type: "ready" })
        log.info(`mounted ${options.rootDir}`)
      })
      .catch((error) => {
        if (controller.signal.aborted) return
        retryOnCompile = true
        setState({ type: "failed", error })
        log.error(error)
      })
  }

  /** Wait for an authenticated worker response without executing application request handlers. */
  async function waitForWorker(signal: AbortSignal) {
    while (!signal.aborted) {
      const response = await gatewayFetch(
        gateway.address,
        gateway.token,
        options.id,
        new Request("http://probe.invalid/", {
          headers: { [WORKER_PROBE_HEADER]: gateway.token },
        }),
        { signal },
      ).catch(() => undefined)
      signal.throwIfAborted()
      await response?.body?.cancel()
      if (response?.status === 204 && response.headers.get(WORKER_PROBE_HEADER) === "ready") return
      if (response && response.status !== 503) {
        throw new Error(
          `nuxt-multi-app: ${options.id} worker failed to initialize (HTTP ${response.status})`,
        )
      }
      // Even a fast transport failure or 503 must not turn startup into a busy retry loop.
      await setTimeout(100, undefined, { signal })
    }
  }

  return {
    id: options.id,
    get state() {
      return state
    },
    start(server: Server) {
      if (closing) return Promise.resolve()
      return (starting ??= start(server).catch((error) => {
        retryOnCompile = false
        if (!closing) setState({ type: "failed", error })
        log.error(error)
        throw error
      }))
    },
    handle: (async (request, response) => {
      while (state.type === "starting") await leftStarting.promise
      // The caller may have given up while the application was loading.
      if (response.destroyed) return
      if (state.type === "ready" && handler) return handler(request, response)
      const reason: MultiAppFallbackReason =
        state.type === "failed"
          ? { type: "failed", appId: options.id, error: state.error }
          : { type: "closing", appId: options.id }
      return fallback(reason, request, response)
    }) satisfies RequestListener,
    get probe() {
      return probeHandler
    },
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
      if (state.type === "failed") stopBuild.resolve()
      setState({ type: "closing" })
      probeController?.abort()
      // Let Nuxt release its watcher, Nitro worker and Vite servers in their registered order.
      return (closing = (async () => {
        await starting?.catch(() => undefined)
        await mounting
        await nuxt?.close()
        log.info("closed")
      })())
    },
  }
}

/** A mounted child in development, addressed by the dev router and the dispatch gateway. */
export type Child = ReturnType<typeof createChild>
