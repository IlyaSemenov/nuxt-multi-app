import assert from "node:assert/strict"
import { existsSync } from "node:fs"
import { createServer } from "node:http"
import { resolve } from "node:path"
import { setTimeout } from "node:timers/promises"

import { toNodeListener } from "h3"
import { buildNuxt, loadNuxt, nuxtCtx } from "nuxt/kit"

// Exercise Nuxt's close lifecycle directly: the CLI can exit without awaiting these hooks.
const nuxt = await loadNuxt({ cwd: resolve("startup/root"), dev: true })
const server = createServer(toNodeListener(nuxt.server.app))
await new Promise((resolve) => server.listen(Number(process.env.PORT), "127.0.0.1", resolve))
await nuxt.callHook("listen", server)
await buildNuxt(nuxt)
while (!existsSync(process.env.NUXT_MULTI_APP_TEST_CLOSE)) await setTimeout(25)
await nuxt.close()
await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
assert.ok(!nuxtCtx.tryUse(), "Closing restored a retired Nuxt context")
