import { appendFile } from "node:fs/promises"
import { setTimeout } from "node:timers/promises"

import { defineNuxtModule, nuxtCtx, useNuxt } from "nuxt/kit"

/** Observe overlapping Nuxt contexts and verify that each generation releases its Vite resources. */
export default defineNuxtModule({
  meta: { name: "nuxt-multi-app-context-probe" },
  setup(_options, nuxt) {
    // `useNuxt()` falls back to the global Kit context whenever a registration runs outside the
    // async context Nuxt wraps its own hooks in, so the loading application has to own it from its
    // first module until its build finishes. Both ends of that window are checked by instance, not
    // by path: two generations of the same mounted application overlap while one is retiring.
    for (const hook of ["modules:done", "build:done"] as const) {
      nuxt.hook(hook, () => {
        const owner = nuxtCtx.tryUse()
        if (owner !== nuxt) {
          const id = owner?.options.rootDir ?? "nobody"
          throw new Error(`nuxt-multi-app: ${id} owns the global Nuxt context at ${hook}`)
        }
      })
    }

    const output = process.env.NUXT_MULTI_APP_TEST_OUTPUT
    if (!process.env.NUXT_MULTI_APP_TEST || !output) return

    const servers: {
      watcher: { getWatched(): Record<string, unknown> }
      ws: { clients: Set<unknown> }
    }[] = []
    nuxt.hook("vite:serverCreated", (server) => {
      servers.push(server)
    })
    nuxt.hook("build:done", () => {
      // Register after the builder's close hooks, so this observes completed native cleanup.
      nuxt.hook("close", () => {
        for (const server of servers) {
          if (Object.keys(server.watcher.getWatched()).length || server.ws.clients.size) {
            throw new Error(
              "nuxt-multi-app: closed generation retained Vite watchers or HMR clients",
            )
          }
        }
      })
    })

    nuxt.hook("app:templatesGenerated", async () => {
      const start = Date.now()
      const expected = nuxt.options.rootDir
      const before = useNuxt().options.rootDir
      await setTimeout(150)
      const after = useNuxt().options.rootDir
      await appendFile(
        output,
        `${JSON.stringify({ start, end: Date.now(), expected, before, after })}\n`,
      )
      if (before !== expected || after !== expected) {
        throw new Error("nuxt-multi-app: Nuxt context was lost across an asynchronous builder hook")
      }
    })

    if (process.env.NUXT_MULTI_APP_TEST_SLOW_CHILD && nuxt.options.rootDir.endsWith("/web")) {
      nuxt.hook("app:templatesGenerated", () => setTimeout(1_000))
    }
  },
})
