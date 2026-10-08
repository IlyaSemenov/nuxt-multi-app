import { describe, expect, it, spyOn } from "bun:test"
import { randomUUID } from "node:crypto"
import type { ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { logger } from "../logger"
import { gatewayFetch } from "../runtime/dispatch"
import { WORKER_PROBE_HEADER } from "../runtime/worker-probe"
import { createGateway } from "./gateway"

describe("development dispatch gateway", () => {
  it("uses authenticated loopback TCP on Windows", async () => {
    const gateway = createGateway(
      (id) =>
        id === "web"
          ? {
              handle(request, response) {
                response.setHeader("content-type", "application/json")
                response.end(JSON.stringify({ path: request.url, host: request.headers.host }))
              },
            }
          : undefined,
      { platform: "win32" },
    )
    try {
      const address = await gateway.listen()
      expect(address).toHaveProperty("host", "127.0.0.1")
      const response = await gatewayFetch(
        address,
        gateway.token,
        "web",
        new Request("https://ignored.example/marker?q=1", {
          headers: { host: "tenant.example" },
        }),
      )
      expect(await response.json()).toEqual({ path: "/marker?q=1", host: "tenant.example" })
    } finally {
      await gateway.close(1_000)
    }
  })

  it("routes worker probes to the target's probe listener", async () => {
    const gateway = createGateway((id) =>
      id === "web"
        ? {
            handle(_request, response) {
              response.end("handled")
            },
            probe(request, response) {
              response.end(
                request.headers[WORKER_PROBE_HEADER] === gateway.token
                  ? "probed"
                  : "unauthenticated",
              )
            },
          }
        : id === "root"
          ? {
              handle(_request, response) {
                response.end("handled")
              },
            }
          : undefined,
    )
    try {
      const address = await gateway.listen()
      const probe = (id: string) =>
        gatewayFetch(
          address,
          gateway.token,
          id,
          new Request("http://ignored.example/", {
            headers: { [WORKER_PROBE_HEADER]: gateway.token },
          }),
        )
      expect(await (await probe("web")).text()).toBe("probed")
      expect((await probe("root")).status).toBe(404)
      const ordinary = await gatewayFetch(
        address,
        gateway.token,
        "web",
        new Request("http://ignored.example/", {
          headers: { [WORKER_PROBE_HEADER]: "1" },
        }),
      )
      expect(await ordinary.text()).toBe("handled")
    } finally {
      await gateway.close(1_000)
    }
  })

  it("ends in-flight calls to an application when its worker is invalidated", async () => {
    let pending: ServerResponse | undefined
    const gateway = createGateway((id) =>
      id === "root"
        ? {
            handle(_request, response) {
              pending = response
              response.flushHeaders()
            },
          }
        : undefined,
    )
    try {
      const address = await gateway.listen()
      const response = await gatewayFetch(
        address,
        gateway.token,
        "root",
        new Request("http://ignored.example/slow"),
      )
      gateway.invalidate("root")
      expect(pending?.destroyed).toBe(true)
      await expect(response.text()).rejects.toThrow()
    } finally {
      await gateway.close(1_000)
    }
  })

  it("falls back to loopback TCP when a Unix socket cannot be opened", async () => {
    // consola log functions carry a `raw` variant, so the stub needs one too.
    const silent = Object.assign(() => undefined, { raw: () => undefined })
    const warning = spyOn(logger, "warn").mockImplementation(silent)
    const gateway = createGateway(() => undefined, {
      platform: "darwin",
      socketPath: join(tmpdir(), randomUUID(), "gateway.sock"),
    })
    try {
      expect(await gateway.listen()).toHaveProperty("host", "127.0.0.1")
      expect(warning).toHaveBeenCalledTimes(1)
    } finally {
      await gateway.close(1_000)
      warning.mockRestore()
    }
  })
})
