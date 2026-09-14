import { describe, expect, it } from "bun:test"

import { selectApplication } from "./routing"

const apps = [
  { id: "root", paths: [], hosts: ["example.test"] },
  { id: "web", paths: [], hosts: ["*.tenant.test"] },
]

function request(host: string, path = "/") {
  return { headers: { host }, url: path } as import("node:http").IncomingMessage
}

describe("application routing", () => {
  it("uses the longest segment-boundary path prefix before the resolver", async () => {
    const pathApps = [
      { id: "root", paths: ["/api"], hosts: ["example.test"] },
      { id: "web", paths: ["/api/admin"], hosts: ["*.tenant.test"] },
    ]
    expect(
      (await selectApplication(pathApps, false, () => false, request("unknown.test", "/api")))?.id,
    ).toBe("root")
    expect(
      (
        await selectApplication(
          pathApps,
          false,
          undefined,
          request("unknown.test", "/api/admin/users?active=1"),
        )
      )?.id,
    ).toBe("web")
    expect(
      await selectApplication(pathApps, false, undefined, request("unknown.test", "/apix")),
    ).toBeUndefined()
  })

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
