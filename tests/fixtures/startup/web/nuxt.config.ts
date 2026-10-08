import { fileURLToPath } from "node:url"

import { defineEventHandler } from "h3"
import { defineNuxtConfig } from "nuxt/config"

export default defineNuxtConfig({
  devtools: { enabled: false },
  serverHandlers: ["/probe/**", "/__nuxt_multi_app/**"].map((route) => ({
    route,
    handler: fileURLToPath(new URL("./wildcard.ts", import.meta.url)),
  })),
  nitro: {
    plugins: [
      fileURLToPath(new URL("../../web/server/plugins/worker-startup-barrier.ts", import.meta.url)),
    ],
    // A readiness probe must bypass the dev server's middleware as well as the worker's handlers.
    devHandlers: [
      {
        handler: defineEventHandler((event) => {
          if (!event.node.req.headers["x-test-client"]) {
            event.node.res.statusCode = 503
            return "development middleware"
          }
        }),
      },
    ],
  },
})
