/**
 * @typedef {{ type: "unmatched", host: string } | { type: "starting" | "closing", appId: string } | { type: "failed", appId: string, error: unknown } | { type: "resolver-error", error: unknown }} MultiAppState
 */

/**
 * Render the stable built-in response for a multi-application routing state.
 *
 * @param {MultiAppState} state
 * @param {import("node:http").IncomingMessage} _request
 * @param {import("node:http").ServerResponse} response
 */
export function defaultStateHandler(state, _request, response) {
  if (state.type === "unmatched") {
    response.statusCode = 404
    response.end("No Nuxt application matches this request")
    return
  }
  if (state.type === "starting" || state.type === "closing") {
    response.statusCode = 503
    response.setHeader("retry-after", "1")
    response.end(`Nuxt application ${state.appId} is ${state.type}`)
    return
  }
  response.statusCode = 500
  response.end(
    state.type === "failed"
      ? `Nuxt application ${state.appId} failed to start`
      : "Nuxt application routing failed",
  )
}
