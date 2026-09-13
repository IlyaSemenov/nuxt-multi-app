import type { IncomingMessage, ServerResponse } from "node:http"

/** Return only the path used by package control endpoints. */
export function requestPath(request: IncomingMessage) {
  return new URL(request.url ?? "/", "http://nuxt-multi-app.local").pathname
}

/** Answer the readiness endpoint from the lifecycle state of every application. */
export function sendReadiness(
  response: ServerResponse,
  states: Record<string, string>,
  debug: boolean,
) {
  const ready = Object.values(states).every((state) => state === "ready")
  response.statusCode = ready ? 200 : 503
  response.setHeader("content-type", "application/json; charset=utf-8")
  response.setHeader("cache-control", "no-store")
  if (!ready) response.setHeader("retry-after", "1")
  response.end(JSON.stringify({ ready, apps: debug ? states : undefined }))
}

/**
 * Convert an absolute Web Request URL to the only address accepted by internal dispatch.
 */
export function internalPath(request: Request) {
  const url = new URL(request.url)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError(
      "nuxt-multi-app: dispatch requires an HTTP Request without credentials or hash",
    )
  }
  // Discard the origin so an application base URL can never turn dispatch into public TCP traffic.
  return `${url.pathname}${url.search}`
}
