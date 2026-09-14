import { describe, expect, it } from "bun:test"
import type { ServerResponse } from "node:http"

import type { MultiAppResolver, MultiAppStateHandler } from "../options"
import { initializeFactory } from "./factories"

describe("runtime factory initialization", () => {
  it("initializes a resolver once", async () => {
    let calls = 0
    const resolver = await initializeFactory<MultiAppResolver>(() => {
      calls++
      return () => "root"
    }, "resolver")

    expect(await resolver("example.test", {} as never)).toBe("root")
    expect(calls).toBe(1)
  })

  it("reports initialization failures as startup errors", async () => {
    await expect(
      initializeFactory(() => {
        throw new Error("missing APP_BASE_URL")
      }, "resolver"),
    ).rejects.toThrow("resolver initialization failed")
  })

  it("initializes a state handler through the same startup contract", async () => {
    const handler = await initializeFactory<MultiAppStateHandler>(
      () => (_state, _request, response) => {
        response.end("custom")
      },
      "state handler",
    )
    let body: string | undefined
    const response = { end: (value: string) => (body = value) } as unknown as ServerResponse
    await handler({ type: "unmatched", host: "example.test" }, {} as never, response)
    expect(body).toBe("custom")
  })
})
