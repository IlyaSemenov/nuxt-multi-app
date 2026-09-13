import { describe, expect, it, spyOn } from "bun:test"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { createGateway } from "./gateway"
import { gatewayFetch } from "./runtime/dispatch"

describe("development dispatch gateway", () => {
  it("uses authenticated loopback TCP on Windows", async () => {
    const gateway = createGateway(
      (id) =>
        id === "web"
          ? {
              id,
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

  it("falls back to loopback TCP when a Unix socket cannot be opened", async () => {
    const warning = spyOn(console, "warn").mockImplementation(() => undefined)
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
