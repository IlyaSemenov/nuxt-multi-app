import { describe, expect, it } from "bun:test"

import type { NormalizedAppOptions } from "../options"
import { selectApplication } from "./routing"

const apps = [
  { id: "root", hosts: ["example.test"] },
  { id: "web", hosts: ["*.tenant.test"] },
] as NormalizedAppOptions[]

function request(host: string, path = "/") {
  return { headers: { host }, url: path } as import("node:http").IncomingMessage
}

describe("application routing", () => {
  it("routes by static hosts without a resolver", async () => {
    expect((await selectApplication(apps, false, undefined, request("example.test")))?.id).toBe(
      "root",
    )
  })

  it("uses resolver, hosts, fallback, and unmatched in order", async () => {
    const resolver = (_host: string, req: import("node:http").IncomingMessage) =>
      req.url?.startsWith("/api/") ? "web" : undefined
    expect(
      (await selectApplication(apps, "root", resolver, request("example.test", "/api/rpc")))?.id,
    ).toBe("web")
    expect((await selectApplication(apps, "web", resolver, request("example.test")))?.id).toBe(
      "root",
    )
    expect((await selectApplication(apps, false, resolver, request("foo.tenant.test")))?.id).toBe(
      "web",
    )
    expect(await selectApplication(apps, false, resolver, request("unknown.test"))).toBeUndefined()
  })

  it("does not fall through when a resolver returns an unknown ID", async () => {
    await expect(
      selectApplication(apps, "web", () => "missing", request("example.test")),
    ).rejects.toThrow("unknown application")
  })

  it("lets the resolver explicitly reject a request without using hosts or fallback", async () => {
    expect(
      await selectApplication(apps, "web", () => false, request("example.test")),
    ).toBeUndefined()
  })
})
