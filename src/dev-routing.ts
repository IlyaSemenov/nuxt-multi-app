import type { Buffer } from "node:buffer"
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"

import type { ChildState } from "./child"
import { logger } from "./logger"
import type { MultiAppStateHandler, NormalizedAppOptions } from "./options"
import { requestPath, sendReadiness } from "./runtime/request"
import { normalizeHost, selectApplication, type RuntimeRoutingRule } from "./runtime/routing"

type UpgradeListener = (request: IncomingMessage, socket: Duplex, head: Buffer) => void

export interface DevEndpoint {
  options: NormalizedAppOptions
  readonly state: ChildState
  handle: RequestListener
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): unknown
}

/** Install request and WebSocket routing while retaining the CLI-owned listener lifecycle. */
export function installDevRouting(
  server: Server,
  endpoints: DevEndpoint[],
  rootHmr: UpgradeListener,
  routing: RuntimeRoutingRule[],
  stateHandler: MultiAppStateHandler,
  readinessPath: string | undefined,
  debug: boolean,
) {
  const requestListeners = server.rawListeners("request") as RequestListener[]
  const upgradeListeners = server.rawListeners("upgrade") as UpgradeListener[]
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

  async function choose(request: IncomingMessage) {
    return selectApplication(
      endpoints.map((endpoint) => endpoint.options),
      routing,
      request,
    ).then((selected) =>
      selected ? endpoints.find((endpoint) => endpoint.options.id === selected.id) : undefined,
    )
  }

  function onRequest(request: IncomingMessage, response: ServerResponse) {
    if (readinessPath && requestPath(request) === readinessPath) {
      sendReadiness(
        response,
        Object.fromEntries(endpoints.map((endpoint) => [endpoint.options.id, endpoint.state.type])),
        debug,
      )
      return
    }
    void choose(request)
      .then((endpoint) => {
        if (debug && request.headers.accept?.includes("text/html")) {
          logger.info(`${request.headers.host ?? ""} -> ${endpoint?.options.id ?? "unmatched"}`)
        }
        if (endpoint) {
          return endpoint.handle(request, response)
        }
        return stateHandler(
          { type: "unmatched", host: normalizeHost(request.headers.host) },
          request,
          response,
        )
      })
      .catch((error) => stateHandler({ type: "resolver-error", error }, request, response))
      .catch((error) => failResponse(response, error))
  }

  function onUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    void choose(request)
      .then((endpoint) => (endpoint ? endpoint.upgrade(request, socket, head) : socket.destroy()))
      .catch((error) => {
        // A peer that leaves during the upgrade destroys the socket itself; only report live failures.
        if (!socket.destroyed) logger.error("WebSocket routing failed", error)
        socket.destroy()
      })
  }

  server.on("request", onRequest)
  server.on("upgrade", onUpgrade)
  return {
    dispose() {
      server.off("request", onRequest)
      for (const listener of requestListeners) server.on("request", listener)
      // Nuxt CLI removes upgrade listeners during close, so do not resurrect them afterwards.
      if (server.listeners("upgrade").includes(onUpgrade)) {
        server.off("upgrade", onUpgrade)
        for (const listener of upgradeListeners) server.on("upgrade", listener)
      }
    },
  }
}

function failResponse(response: ServerResponse, error: unknown) {
  logger.error("state handler failed", error)
  if (response.headersSent) response.destroy(error as Error)
  else {
    response.statusCode = 500
    response.end("Nuxt application routing failed")
  }
}
