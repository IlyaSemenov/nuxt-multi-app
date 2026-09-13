import type { IncomingMessage } from "node:http"

/** Return only the path used by package control endpoints. */
export function requestPath(request: IncomingMessage) {
  return new URL(request.url ?? "/", "http://nuxt-multi-app.local").pathname
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
