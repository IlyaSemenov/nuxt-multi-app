import { fileURLToPath } from "node:url"

import { defineNuxtConfig } from "nuxt/config"

import contextProbe from "../context-probe"
import lateNitroOutput from "../late-nitro-output"

export default defineNuxtConfig({
  compatibilityDate: "2026-09-12",
  devtools: { enabled: false },
  vite: { server: { allowedHosts: ["landing.localhost"] } },
  modules: [
    contextProbe,
    lateNitroOutput,
    [
      "nuxt-multi-app",
      {
        root: { id: "root" },
        apps: [
          {
            id: "web",
            rootDir: "../web",
            overrides: {
              plugins: [fileURLToPath(new URL("./root-plugin.ts", import.meta.url))],
            },
          },
        ],
        routing: [
          { paths: ["/api/owner/"], app: "web" },
          { resolver: "./resolver.ts" },
          { hosts: ["landing.localhost"], app: "root" },
          { hosts: ["*.tenant.localhost"], app: "web" },
        ],
        readinessPath: "/__nuxt_multi_app/ready",
        stateHandler: "./state-handler.ts",
        shutdownTimeout: 1_000,
      },
    ],
  ],
})
