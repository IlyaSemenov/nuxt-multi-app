import type { Buffer } from "node:buffer"
import type { IncomingMessage, RequestListener, Server, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"

import type { ChildState } from "./child"
import type { MultiAppResolver, MultiAppStateHandler, NormalizedAppOptions } from "./options"
import { requestPath } from "./runtime/request"
import { normalizeHost, selectApplication } from "./runtime/routing.mjs"

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
  resolver: MultiAppResolver | undefined,
  stateHandler: MultiAppStateHandler,
  fallback: string | false,
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
      fallback,
      resolver,
      request,
    ).then((selected) =>
      selected ? endpoints.find((endpoint) => endpoint.options.id === selected.id) : undefined,
    )
  }

  function request(request: IncomingMessage, response: ServerResponse) {
    if (readinessPath && requestPath(request) === readinessPath) {
      sendReadiness(endpoints, response, debug)
      return
    }
    void choose(request)
      .then((endpoint) => {
        if (debug && request.headers.accept?.includes("text/html")) {
          console.log(
            `[nuxt-multi-app] ${request.headers.host ?? ""} -> ${endpoint?.options.id ?? "unmatched"}`,
          )
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

  function upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
    void choose(request)
      .then((endpoint) => (endpoint ? endpoint.upgrade(request, socket, head) : socket.destroy()))
      .catch((error) => {
        console.error("[nuxt-multi-app] WebSocket routing failed", error)
        socket.destroy()
      })
  }

  server.on("request", request)
  server.on("upgrade", upgrade)
  return {
    dispose() {
      server.off("request", request)
      for (const listener of requestListeners) server.on("request", listener)
      // Nuxt CLI removes upgrade listeners during close, so do not resurrect them afterwards.
      if (server.listeners("upgrade").includes(upgrade)) {
        server.off("upgrade", upgrade)
        for (const listener of upgradeListeners) server.on("upgrade", listener)
      }
    },
  }
}

function sendReadiness(endpoints: DevEndpoint[], response: ServerResponse, debug: boolean) {
  const ready = endpoints.every((endpoint) => endpoint.state.type === "ready")
  response.statusCode = ready ? 200 : 503
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  if (!ready) response.setHeader("retry-after", "1")
  response.end(
    JSON.stringify({
      ready,
      apps: debug
        ? Object.fromEntries(
            endpoints.map((endpoint) => [endpoint.options.id, endpoint.state.type]),
          )
        : undefined,
    }),
  )
}

function failResponse(response: ServerResponse, error: unknown) {
  console.error("[nuxt-multi-app] state handler failed", error)
  if (response.headersSent) response.destroy(error as Error)
  else {
    response.statusCode = 500
    response.end("Nuxt application routing failed")
  }
}
