import { defineNuxtConfig } from "nuxt/config"

import contextProbe from "../context-probe"
import isolatedModule from "./modules/isolated/module"

export default defineNuxtConfig({
  compatibilityDate: "2026-09-12",
  devtools: { enabled: false },
  modules: [isolatedModule, contextProbe],
  nitro: { experimental: { websocket: true } },
  vite: { server: { allowedHosts: ["foo.tenant.localhost", "landing.localhost"] } },
})
