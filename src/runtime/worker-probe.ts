import { sendNoContent, type App } from "h3"

/** Private gateway credential that identifies a worker readiness probe. */
export const WORKER_PROBE_HEADER = "x-nuxt-multi-app-probe"

/** Answer authenticated probes before request hooks, middleware and routing can run. */
export function installWorkerProbe(app: App, token: string) {
  const handle = app.handler
  app.handler = (event) => {
    if (token && event.node.req.headers[WORKER_PROBE_HEADER] === token) {
      event.node.res.setHeader(WORKER_PROBE_HEADER, "ready")
      return sendNoContent(event)
    }
    return handle(event)
  }
}
