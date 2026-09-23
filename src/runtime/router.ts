import type { Buffer } from "node:buffer"
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"

import type { MultiAppFallback } from "./fallback"
import type { UpgradeHandler } from "./registry"
import { requestPath } from "./request"
import { normalizeHost, selectApplication, type RuntimeRoutingRule } from "./routing"

/** Output channel for routing diagnostics; development and production log differently. */
export interface RouterLogger {
  info(message: string): void
  error(message: string, error: unknown): void
}

/** Applications, routing, and the environment-specific ways to hand a request to an application. */
export interface RouterOptions<App extends { id: string }> {
  apps: App[]
  routing: RuntimeRoutingRule[]
  fallback: MultiAppFallback
  readinessPath: string | undefined
  /** Lifecycle state of every application by ID; the endpoint is ready when all are `ready`. */
  readiness(): Record<string, string>
  debug: boolean
  logger: RouterLogger
  /** Serve a request with the selected application. */
  handle(app: App, request: IncomingMessage, response: ServerResponse): unknown
  /** Complete a WebSocket upgrade with the selected application. */
  upgrade(app: App, request: IncomingMessage, socket: Duplex, head: Buffer): unknown
}

/** Create the public listeners that route every request once, to an application or the fallback. */
export function createRouter<App extends { id: string }>(options: RouterOptions<App>) {
  const choose = (request: IncomingMessage) =>
    selectApplication(options.apps, options.routing, request)

  const request: RequestListener = (request, response) => {
    if (options.readinessPath && requestPath(request) === options.readinessPath) {
      sendReadiness(response, options.readiness(), options.debug)
      return
    }
    void choose(request)
      .then((app) => {
        if (options.debug && request.headers.accept?.includes("text/html")) {
          options.logger.info(`${request.headers.host ?? ""} -> ${app?.id ?? "unmatched"}`)
        }
        if (app) return options.handle(app, request, response)
        return options.fallback(
          { type: "unmatched", host: normalizeHost(request.headers.host) },
          request,
          response,
        )
      })
      .catch((error) => options.fallback({ type: "resolver-error", error }, request, response))
      .catch((error) => {
        options.logger.error("fallback failed", error)
        if (response.headersSent) response.destroy(error as Error)
        else {
          response.statusCode = 500
          response.end("Nuxt application routing failed")
        }
      })
  }

  const upgrade: UpgradeHandler = (request, socket, head) => {
    void choose(request)
      .then((app) => (app ? options.upgrade(app, request, socket, head) : socket.destroy()))
      .catch((error) => {
        // A peer that leaves during the upgrade destroys the socket itself; only report live failures.
        if (!socket.destroyed) options.logger.error("WebSocket routing failed", error)
        socket.destroy()
      })
  }

  return { request, upgrade }
}

/** Answer the readiness endpoint from the lifecycle state of every application. */
function sendReadiness(response: ServerResponse, states: Record<string, string>, debug: boolean) {
  const ready = Object.values(states).every((state) => state === "ready")
  response.statusCode = ready ? 200 : 503
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  if (!ready) response.setHeader("retry-after", "1")
  response.end(JSON.stringify({ ready, apps: debug ? states : undefined }))
}
