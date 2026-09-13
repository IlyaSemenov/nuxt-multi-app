import { describe, expect, it } from "bun:test"
import type { ServerResponse } from "node:http"

import type { MultiAppResolver, MultiAppStateHandler } from "../options"
import { initializeFactory } from "./factories"

describe("runtime factory initialization", () => {
  it("passes known application IDs and initializes once", async () => {
    let calls = 0
    const resolver = await initializeFactory<MultiAppResolver>(
      ({ appIds }) => {
        calls++
        expect([...appIds]).toEqual(["root", "web"])
        return () => "root"
      },
      ["root", "web"],
      "resolver",
    )

    expect(await resolver("example.test", {} as never)).toBe("root")
    expect(calls).toBe(1)
  })

  it("reports initialization failures as startup errors", async () => {
    await expect(
      initializeFactory(
        () => {
          throw new Error("missing APP_BASE_URL")
        },
        ["root"],
        "resolver",
      ),
    ).rejects.toThrow("resolver initialization failed")
  })

  it("initializes a state handler through the same startup contract", async () => {
    const handler = await initializeFactory<MultiAppStateHandler>(
      ({ appIds }) => {
        expect([...appIds]).toEqual(["root"])
        return (_state, _request, response) => {
          response.end("custom")
        }
      },
      ["root"],
      "state handler",
    )
    let body: string | undefined
    const response = { end: (value: string) => (body = value) } as unknown as ServerResponse
    await handler({ type: "unmatched", host: "example.test" }, {} as never, response)
    expect(body).toBe("custom")
  })
})
