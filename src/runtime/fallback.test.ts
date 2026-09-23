import { describe, expect, it } from "bun:test"
import type { ServerResponse } from "node:http"

import { defaultFallback, type MultiAppFallbackReason } from "./fallback"

function render(reason: MultiAppFallbackReason) {
  let body: string | undefined
  const headers = new Map<string, string | number | readonly string[]>()
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, value)
    },
    end(value: string) {
      body = value
    },
  } as unknown as ServerResponse

  defaultFallback(reason, {} as never, response)

  return { status: response.statusCode, headers, body }
}

describe("default fallback responses", () => {
  it("renders requests with no matching application", () => {
    expect(render({ type: "unmatched", host: "unknown.test" })).toEqual({
      status: 404,
      headers: new Map(),
      body: "No Nuxt application matches this request",
    })
  })

  for (const type of ["starting", "closing"] as const) {
    it(`renders an application that is ${type}`, () => {
      expect(render({ type, appId: "web" })).toEqual({
        status: 503,
        headers: new Map([["retry-after", "1"]]),
        body: `Nuxt application web is ${type}`,
      })
    })
  }

  it("renders an application startup failure", () => {
    expect(render({ type: "failed", appId: "web", error: new Error("failed") })).toEqual({
      status: 500,
      headers: new Map(),
      body: "Nuxt application web failed to start",
    })
  })

  it("renders a resolver failure", () => {
    expect(render({ type: "resolver-error", error: new Error("failed") })).toEqual({
      status: 500,
      headers: new Map(),
      body: "Nuxt application routing failed",
    })
  })
})
