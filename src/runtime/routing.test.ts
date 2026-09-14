import { describe, expect, it } from "bun:test"
import type { IncomingMessage } from "node:http"

import { selectApplication, type RuntimeRoutingRule } from "./routing"

const apps = [{ id: "root" }, { id: "web" }, { id: "admin" }]

function request(host: string, url = "/") {
  return { headers: { host }, url } as IncomingMessage
}

describe("application routing", () => {
  it("uses the first matching rule", async () => {
    const routing: RuntimeRoutingRule[] = [
      { paths: ["/api"], app: "web" },
      { paths: ["/api/admin"], app: "admin" },
      { app: "root" },
    ]

    expect(
      (await selectApplication(apps, routing, request("example.test", "/api/admin")))?.id,
    ).toBe("web")
  })

  it("uses OR within guards and AND across host and path guards", async () => {
    const routing: RuntimeRoutingRule[] = [
      {
        hosts: ["example.test", "*.tenant.test"],
        paths: ["/api", "/_e2e"],
        app: "web",
      },
      { app: "root" },
    ]

    expect((await selectApplication(apps, routing, request("foo.tenant.test", "/_e2e")))?.id).toBe(
      "web",
    )
    expect((await selectApplication(apps, routing, request("example.test", "/page")))?.id).toBe(
      "root",
    )
    expect((await selectApplication(apps, routing, request("other.test", "/api")))?.id).toBe("root")
  })

  it("matches path prefixes only at a segment boundary using the raw pathname", async () => {
    const routing: RuntimeRoutingRule[] = [{ paths: ["/api"], app: "web" }]

    expect((await selectApplication(apps, routing, request("example.test", "/api")))?.id).toBe(
      "web",
    )
    expect(
      (await selectApplication(apps, routing, request("example.test", "/api/users?next=/other")))
        ?.id,
    ).toBe("web")
    expect(
      await selectApplication(apps, routing, request("example.test", "/apiary")),
    ).toBeUndefined()
    expect(
      await selectApplication(apps, routing, request("example.test", "/other/../api")),
    ).toBeUndefined()
    expect(
      await selectApplication(apps, routing, request("example.test", "/%61pi")),
    ).toBeUndefined()
  })

  it("guards a resolver and continues when the guard or resolver does not select an app", async () => {
    let calls = 0
    const routing: RuntimeRoutingRule[] = [
      {
        hosts: ["*.tenant.test"],
        resolver: () => {
          calls++
          return undefined
        },
      },
      { hosts: ["example.test", "*.tenant.test"], app: "root" },
    ]

    expect((await selectApplication(apps, routing, request("example.test")))?.id).toBe("root")
    expect(calls).toBe(0)
    expect((await selectApplication(apps, routing, request("foo.tenant.test")))?.id).toBe("root")
    expect(calls).toBe(1)
  })

  it("stops as unmatched when a resolver returns false", async () => {
    const routing: RuntimeRoutingRule[] = [{ resolver: () => false }, { app: "root" }]

    expect(await selectApplication(apps, routing, request("example.test"))).toBeUndefined()
  })

  it("rejects an unknown resolver result", async () => {
    const routing: RuntimeRoutingRule[] = [{ resolver: () => "missing" as never }]

    await expect(selectApplication(apps, routing, request("example.test"))).rejects.toThrow(
      "unknown application",
    )
  })
})
