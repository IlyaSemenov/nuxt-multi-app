import type { RequestListener, Server } from "node:http"

import { logger } from "../logger"
import type { NormalizedAppOptions } from "../options"
import type { UpgradeHandler } from "../runtime/contract"
import type { MultiAppFallback } from "../runtime/fallback"
import { createRouter } from "../runtime/router"
import type { RuntimeRoutingRule } from "../runtime/routing"
import type { ChildState } from "./child"

export interface DevEndpoint {
  readonly id: string
  options: NormalizedAppOptions
  readonly state: ChildState
  handle: RequestListener
  upgrade: UpgradeHandler
}

/** Install request and WebSocket routing while retaining the CLI-owned listener lifecycle. */
export function installDevRouting(
  server: Server,
  endpoints: DevEndpoint[],
  rootHmr: UpgradeHandler,
  routing: RuntimeRoutingRule[],
  fallback: MultiAppFallback,
  readinessPath: string | undefined,
  debug: boolean,
) {
  const requestListeners = server.rawListeners("request") as RequestListener[]
  const upgradeListeners = server.rawListeners("upgrade") as UpgradeHandler[]
  for (const listener of requestListeners) server.off("request", listener)
  for (const listener of upgradeListeners) server.off("upgrade", listener)

  const root = endpoints.find((endpoint) => endpoint.options.isRoot)
  if (!root) throw new Error("nuxt-multi-app: the root endpoint is missing")
  root.handle = ((request, response) => {
    for (const listener of requestListeners) listener.call(server, request, response)
  }) satisfies RequestListener
  root.upgrade = (request, socket, head) => {
    if (request.headers["sec-websocket-protocol"] === "vite-hmr") {
      rootHmr(request, socket, head)
      return
    }
    for (const listener of upgradeListeners) listener.call(server, request, socket, head)
  }

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
