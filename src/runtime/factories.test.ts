import { describe, expect, it } from "bun:test"
import type { ServerResponse } from "node:http"

import { initializeFactory } from "./factories"
import type { MultiAppFallback } from "./fallback"
import type { MultiAppResolver } from "./routing"

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

  it("initializes a fallback through the same startup contract", async () => {
    const handler = await initializeFactory<MultiAppFallback>(
      () => (_state, _request, response) => {
        response.end("custom")
      },
      "fallback",
    )
    let body: string | undefined
    const response = { end: (value: string) => (body = value) } as unknown as ServerResponse
    await handler({ type: "unmatched", host: "example.test" }, {} as never, response)
    expect(body).toBe("custom")
  })
})
