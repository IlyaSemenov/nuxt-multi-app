import { writeFileSync } from "node:fs"

import { defineMultiAppResolver } from "nuxt-multi-app"

export default defineMultiAppResolver(() => () => {
  // Acknowledge routing before the test sends SIGINT, so the request is already held by the child.
  writeFileSync(process.env.NUXT_MULTI_APP_TEST_CLOSING_REQUEST!, "")
  return "web"
})
