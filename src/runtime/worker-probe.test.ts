import { describe, expect, it } from "bun:test"

import { createApp, defineEventHandler, setResponseStatus, toWebHandler } from "h3"

import { installWorkerProbe, WORKER_PROBE_HEADER } from "./worker-probe"

describe("worker readiness probe", () => {
  it("bypasses request hooks and middleware only with the gateway credential", async () => {
    const requests: string[] = []
    const app = createApp({
      onRequest() {
        requests.push("request hook")
      },
    }).use(
      defineEventHandler((event) => {
        requests.push("middleware")
        setResponseStatus(event, 503)
        return "application unavailable"
      }),
    )
    installWorkerProbe(app, "private-token")
    const handle = toWebHandler(app)

    const probe = await handle(
      new Request("http://localhost/", {
        headers: { [WORKER_PROBE_HEADER]: "private-token" },
      }),
    )
    expect(probe.status).toBe(204)
    expect(probe.headers.get(WORKER_PROBE_HEADER)).toBe("ready")
    expect(requests).toEqual([])

    for (const credential of [undefined, "1"]) {
      const response = await handle(
        new Request("http://localhost/__nuxt_multi_app/worker", {
          headers: credential ? { [WORKER_PROBE_HEADER]: credential } : {},
        }),
      )
      expect(response.status).toBe(503)
      expect(await response.text()).toBe("application unavailable")
    }
    expect(requests).toEqual(["request hook", "middleware", "request hook", "middleware"])
  })
})
