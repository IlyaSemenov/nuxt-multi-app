import { appendFileSync } from "node:fs"

import { defineMultiAppResolver } from "nuxt-multi-app"

const output = process.env.NUXT_MULTI_APP_TEST_RESOLVER_OUTPUT
if (output) appendFileSync(output, "import\n")

export default defineMultiAppResolver(() => {
  if (output) appendFileSync(output, "initialize\n")
  if (import.meta.env.NUXT_MULTI_APP_TEST_RESOLVER_FAIL) {
    throw new Error("intentional resolver initialization failure")
  }
  const runtimeBase = process.env.NUXT_MULTI_APP_TEST_BASE
  return (host) => {
    if (runtimeBase && host === runtimeBase) return "root"
  }
})
