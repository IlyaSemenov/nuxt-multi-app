import { appendFileSync } from "node:fs"

import { defineMultiAppResolver } from "nuxt-multi-app"

const output = process.env.NUXT_MULTI_APP_TEST_RESOLVER_OUTPUT
if (output) appendFileSync(output, "import\n")

export default defineMultiAppResolver(({ appIds }) => {
  if (output) appendFileSync(output, "initialize\n")
  if (process.env.NUXT_MULTI_APP_TEST_RESOLVER_FAIL) {
    throw new Error("intentional resolver initialization failure")
  }
  for (const id of ["root", "web"] as const) {
    if (!appIds.has(id)) throw new Error(`fixture requires application ${id}`)
  }
  const runtimeBase = process.env.NUXT_MULTI_APP_TEST_BASE
  return (host, request) => {
    if (request.url?.startsWith("/api/owner")) return "web"
    if (runtimeBase && host === runtimeBase) return "root"
  }
})
