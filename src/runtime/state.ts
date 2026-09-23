import type { IncomingMessage, ServerResponse } from "node:http"

/** State passed to the optional state-handler module. */
export type MultiAppState =
  | { type: "unmatched"; host: string }
  | { type: "starting"; appId: string }
  | { type: "closing"; appId: string }
  | { type: "failed"; appId: string; error: unknown }
  | { type: "resolver-error"; error: unknown }

/** A state-handler module renders failures and requests that have no application. */
export type MultiAppStateHandler = (
  state: MultiAppState,
  request: IncomingMessage,
  response: ServerResponse,
) => void | Promise<void>

/** A project module factory that initializes one state handler before requests are accepted. */
export type MultiAppStateHandlerFactory = () => MultiAppStateHandler | Promise<MultiAppStateHandler>

/** Render the stable built-in response for a multi-application routing state. */
export const defaultStateHandler: MultiAppStateHandler = (state, _request, response) => {
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
