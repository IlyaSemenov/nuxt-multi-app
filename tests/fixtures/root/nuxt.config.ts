import { fileURLToPath } from "node:url"

import { defineNuxtConfig } from "nuxt/config"

import contextProbe from "../context-probe"

export default defineNuxtConfig({
  compatibilityDate: "2026-09-12",
  devtools: { enabled: false },
  vite: { server: { allowedHosts: ["landing.localhost"] } },
  modules: [
    contextProbe,
    [
      "nuxt-multi-app",
      {
        root: { id: "root", hosts: ["landing.localhost"] },
        apps: [
          {
            id: "web",
            rootDir: "../web",
            hosts: ["*.tenant.localhost"],
            overrides: {
              plugins: [fileURLToPath(new URL("./root-plugin.ts", import.meta.url))],
            },
          },
        ],
        fallback: false,
        readinessPath: "/__nuxt_multi_app/ready",
        resolver: "./resolver.ts",
        stateHandler: "./state-handler.ts",
        shutdownTimeout: 1_000,
      },
    ],
  ],
})
