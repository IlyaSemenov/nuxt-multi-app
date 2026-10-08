import { defineNuxtConfig } from "nuxt/config"

export default defineNuxtConfig({
  devtools: { enabled: false },
  modules: ["nuxt-multi-app"],
  multiApp: {
    root: { id: "root" },
    apps: [
      { id: "web", rootDir: "../web" },
      { id: "api", rootDir: "../api" },
    ],
    routing: [
      { paths: ["/api/backend"], app: "api" },
      { paths: ["/probe/closing"], resolver: "./closing-resolver.ts" },
      { app: "web" },
    ],
    readinessPath: "/ready",
    debug: true,
    shutdownTimeout: 1_000,
  },
})
