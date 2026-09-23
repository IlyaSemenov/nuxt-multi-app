import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { getProductionRuntime, type ProductionManifest } from "./contract"
import { createProductionServer, type ProductionServer } from "./production-server"

/** An application bundle that registers a stub Nitro runtime the way the Nitro plugin does. */
function appBundle(id: string) {
  return `
const runtime = globalThis[Symbol.for("nuxt-multi-app.runtime")]
runtime.register(${JSON.stringify(id)}, {
  hooks: { hook() {}, async callHook(name) { globalThis.__closed.push(${JSON.stringify(id)}) } },
  localFetch: async (path) => new Response(${JSON.stringify(id)} + " dispatch " + path),
})
export const handler = (request, response) => response.end(${JSON.stringify(id)} + " " + request.url)
`
}

describe("production server", () => {
  let dir: string
  let composition: ProductionServer
  let origin: string
  const closed: string[] = []

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nuxt-multi-app-server-"))
    await writeFile(join(dir, "root.mjs"), appBundle("root"))
    await writeFile(join(dir, "web.mjs"), appBundle("web"))
    ;(globalThis as { __closed?: string[] }).__closed = closed
    const manifest: ProductionManifest = {
      apps: [
        { id: "root", entry: "./root.mjs" },
        { id: "web", entry: "./web.mjs" },
      ],
      routing: [{ paths: ["/web"], app: "web" }, { app: "root" }],
      fallback: null,
      shutdownTimeout: 1_000,
      debug: false,
    }
    composition = await createProductionServer(manifest, pathToFileURL(`${dir}/`))
    await new Promise<void>((resolve) => composition.server.listen(0, "127.0.0.1", resolve))
    origin = `http://127.0.0.1:${(composition.server.address() as AddressInfo).port}`
  })

  afterAll(async () => {
    delete (globalThis as { __closed?: string[] }).__closed
    await rm(dir, { recursive: true, force: true })
  })

  it("routes public requests to the imported application handlers", async () => {
    expect(await (await fetch(`${origin}/web/page`)).text()).toBe("web /web/page")
    expect(await (await fetch(`${origin}/`)).text()).toBe("root /")
  })

  it("dispatches between registered applications", async () => {
    const response = await getProductionRuntime()!.dispatch(
      "web",
      new Request("http://ignored.example/api?q=1"),
    )
    expect(await response.text()).toBe("web dispatch /api?q=1")
  })

  it("closes applications in reverse order and removes the registry", async () => {
    await composition.close()
    expect(closed).toEqual(["web", "root"])
    expect(getProductionRuntime()).toBeUndefined()
  })
})
