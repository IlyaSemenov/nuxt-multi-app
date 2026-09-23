import type { IncomingMessage, ServerResponse } from "node:http"

/** Why no application can serve a request, passed to the fallback. */
export type MultiAppFallbackReason =
  | { type: "unmatched"; host: string }
  | { type: "starting"; appId: string }
  | { type: "closing"; appId: string }
  | { type: "failed"; appId: string; error: unknown }
  | { type: "resolver-error"; error: unknown }

/** Respond to a request that no application can serve. */
export type MultiAppFallback = (
  reason: MultiAppFallbackReason,
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>

/** A project module factory that initializes the fallback before requests are accepted. */
export type MultiAppFallbackFactory = () => MultiAppFallback | Promise<MultiAppFallback>

/** Diagnostic label of the fallback module. */
export const FALLBACK_LABEL = "fallback"

/** Render the stable built-in response for each fallback reason. */
export const defaultFallback: MultiAppFallback = (reason, _request, response) => {
  if (reason.type === "unmatched") {
    response.statusCode = 404
    response.end("No Nuxt application matches this request")
    return
  }
  if (reason.type === "starting" || reason.type === "closing") {
    response.statusCode = 503
    response.setHeader("retry-after", "1")
    response.end(`Nuxt application ${reason.appId} is ${reason.type}`)
    return
  }
  response.statusCode = 500
  response.end(
    reason.type === "failed"
      ? `Nuxt application ${reason.appId} failed to start`
      : "Nuxt application routing failed",
  )
}
