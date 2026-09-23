import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import type { ServerResponse } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { initializeFactory, loadFactory } from "./factories"
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
      () => (_reason, _request, response) => {
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

describe("project module loading", () => {
  let dir: string
  const url = (name: string) => pathToFileURL(join(dir, name)).href

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nuxt-multi-app-factories-"))
    // Write every module before the first import: Bun caches directory entries it has resolved.
    await writeFile(join(dir, "resolver.mjs"), 'export default () => () => "web"')
    await writeFile(join(dir, "fallback.mjs"), "export default { handler() {} }")
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it("initializes the default-exported factory", async () => {
    const resolver = await loadFactory<MultiAppResolver>(
      url("resolver.mjs"),
      "resolver in routing rule 1",
    )
    expect(await resolver("example.test", {} as never)).toBe("web")
  })

  it("rejects a module whose default export is not a factory", async () => {
    await expect(loadFactory(url("fallback.mjs"), "fallback")).rejects.toThrow(
      "nuxt-multi-app: fallback module must default-export a factory function",
    )
  })
})
