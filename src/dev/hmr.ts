import type { Server } from "node:http"
import { createServer } from "node:http"

import type { Nuxt } from "nuxt/schema"

import type { UpgradeHandler } from "../runtime/contract"

/**
 * Serve one application's Vite HMR WebSocket through the shared public listener.
 *
 * A mounted application has no listener of its own, so its HMR client connects to the public port
 * on a path unique to the application, and the public router forwards the upgrade here.
 */
export function setupHmr(nuxt: Nuxt, id: string) {
  const transport = createServer()
  let publicServer: Server | undefined

  nuxt.hook("vite:extendConfig", (config, { isClient }) => {
    if (!isClient) return
    const address = publicServer?.address()
    if (!address || typeof address === "string") {
      throw new Error("nuxt-multi-app: an external TCP listener is required for Vite HMR")
    }
    if (!config.server) throw new Error("nuxt-multi-app: Vite server config is missing")
    config.server.hmr = {
      ...(typeof config.server.hmr === "object" ? config.server.hmr : {}),
      server: transport,
      path: `nuxt-multi-app/${id}/hmr`,
      clientPort: address.port,
    }
  })

  return {
    /** Record the public listener, which must happen before Vite resolves its client config. */
    attach(server: Server) {
      publicServer = server
    },
    upgrade: ((request, socket, head) => {
      transport.emit("upgrade", request, socket, head)
    }) satisfies UpgradeHandler,
  }
}
