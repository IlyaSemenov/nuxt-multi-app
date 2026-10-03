import { defineNuxtConfig } from "nuxt/config"

import contextProbe from "../context-probe"
import isolatedModule from "./modules/isolated/module"

export default defineNuxtConfig({
  compatibilityDate: "2026-09-12",
  devtools: { enabled: false },
  modules: [isolatedModule, contextProbe],
  // The test runner installs this package only in the child's own node_modules.
  imports: { imports: [{ from: "child-only-dependency", name: "ChildOnlyProps", type: true }] },
  nitro: { experimental: { websocket: true } },
  vite: { server: { allowedHosts: ["foo.tenant.localhost", "landing.localhost"] } },
})
