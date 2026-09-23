import type { RequestListener, Server } from "node:http"

import { logger } from "../logger"
import type { UpgradeHandler } from "../runtime/contract"
import type { MultiAppFallback } from "../runtime/fallback"
import { createRouter } from "../runtime/router"
import type { RuntimeRoutingRule } from "../runtime/routing"
import type { ChildState } from "./child"

/** One application as the development router and the dispatch gateway address it. */
export interface DevEndpoint {
  readonly id: string
  readonly state: ChildState
  handle: RequestListener
  upgrade: UpgradeHandler
}

/** The root application, whose request handling stays with the listeners Nuxt CLI installed. */
export interface DevRoot {
  id: string
  state(): ChildState
  /** Upgrade listener of the root's Vite HMR transport. */
  hmr: UpgradeHandler
}

/** Everything the development router serves on the CLI-owned public listener. */
export interface DevRoutingOptions {
  root: DevRoot
  children: DevEndpoint[]
  routing: RuntimeRoutingRule[]
  fallback: MultiAppFallback
  readinessPath: string | undefined
  debug: boolean
}

/** Install request and WebSocket routing while retaining the CLI-owned listener lifecycle. */
export function installDevRouting(server: Server, options: DevRoutingOptions) {
  const { routing, fallback, readinessPath, debug } = options
  const requestListeners = server.rawListeners("request") as RequestListener[]
  const upgradeListeners = server.rawListeners("upgrade") as UpgradeHandler[]
  for (const listener of requestListeners) server.off("request", listener)
  for (const listener of upgradeListeners) server.off("upgrade", listener)

  const root: DevEndpoint = {
    id: options.root.id,
    get state() {
      return options.root.state()
    },
    handle(request, response) {
      for (const listener of requestListeners) listener.call(server, request, response)
    },
    upgrade(request, socket, head) {
      if (request.headers["sec-websocket-protocol"] === "vite-hmr") {
        options.root.hmr(request, socket, head)
        return
      }
      for (const listener of upgradeListeners) listener.call(server, request, socket, head)
    },
  }
  const endpoints = [root, ...options.children]
  const endpointsById = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]))

  const router = createRouter({
    apps: endpoints,
    routing,
    fallback,
    readinessPath,
    readiness: () =>
      Object.fromEntries(endpoints.map((endpoint) => [endpoint.id, endpoint.state.type])),
    debug,
    logger,
    handle: (endpoint, request, response) => endpoint.handle(request, response),
    upgrade: (endpoint, request, socket, head) => endpoint.upgrade(request, socket, head),
  })
  server.on("request", router.request)
  server.on("upgrade", router.upgrade)
  return {
    /** Find an application for the dispatch gateway. */
    endpoint(id: string) {
      return endpointsById.get(id)
    },
    dispose() {
      server.off("request", router.request)
      for (const listener of requestListeners) server.on("request", listener)
      // Nuxt CLI removes upgrade listeners during close, so do not resurrect them afterwards.
      if (server.listeners("upgrade").includes(router.upgrade)) {
        server.off("upgrade", router.upgrade)
        for (const listener of upgradeListeners) server.on("upgrade", listener)
      }
    },
  }
}
