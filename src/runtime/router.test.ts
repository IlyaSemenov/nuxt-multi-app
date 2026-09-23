import { describe, expect, it } from "bun:test"
import type { IncomingMessage, ServerResponse } from "node:http"
import type { Duplex } from "node:stream"

import type { MultiAppFallback } from "./fallback"
import { createRouter } from "./router"
import type { RuntimeRoutingRule } from "./routing"

function createResponse() {
  const response = {
    statusCode: 200,
    headersSent: false,
    headers: new Map<string, unknown>(),
    body: undefined as string | undefined,
    setHeader(name: string, value: unknown) {
      response.headers.set(name, value)
    },
    end(value?: string) {
      response.body = value
    },
  }
  return response
}

function route(options: {
  routing: RuntimeRoutingRule[]
  fallback?: MultiAppFallback
  url?: string
}) {
  const errors: string[] = []
  const handled: string[] = []
  const router = createRouter({
    apps: [{ id: "root" }, { id: "web" }],
    routing: options.routing,
    fallback: options.fallback ?? (() => undefined),
    readinessPath: "/ready",
    readiness: () => ({ root: "ready", web: "starting" }),
    debug: true,
    logger: { info: () => undefined, error: (message) => errors.push(message) },
    handle: (app) => handled.push(app.id),
    upgrade: (app) => handled.push(`upgrade ${app.id}`),
  })
  const request = { url: options.url ?? "/", headers: { host: "example.test" } }
  return { router, request: request as unknown as IncomingMessage, errors, handled }
}

describe("public router", () => {
  it("answers readiness before routing", () => {
    const { router, request, handled } = route({ routing: [{ app: "root" }], url: "/ready?probe" })
    const response = createResponse()
    router.request(request, response as unknown as ServerResponse)
    expect(response.statusCode).toBe(503)
    expect(JSON.parse(response.body!)).toEqual({
      ready: false,
      apps: { root: "ready", web: "starting" },
    })
    expect(handled).toEqual([])
  })

  it("answers 500 when the fallback itself fails", async () => {
    const { router, request, errors } = route({
      routing: [{ hosts: ["other.test"], app: "web" }],
      fallback: () => {
        throw new Error("broken fallback")
      },
    })
    const response = createResponse()
    router.request(request, response as unknown as ServerResponse)
    await Bun.sleep(0)
    expect(response.statusCode).toBe(500)
    expect(response.body).toBe("Nuxt application routing failed")
    expect(errors).toEqual(["fallback failed"])
  })

  it("closes an upgrade that no application selects", async () => {
    const { router, request, handled } = route({ routing: [{ hosts: ["other.test"], app: "web" }] })
    let destroyed = false
    const socket = {
      destroyed: false,
      destroy() {
        destroyed = true
      },
    }
    router.upgrade(request, socket as unknown as Duplex, Buffer.alloc(0))
    await Bun.sleep(0)
    expect(destroyed).toBe(true)
    expect(handled).toEqual([])
  })
})
