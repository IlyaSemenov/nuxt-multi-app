import { appendFileSync } from "node:fs"

export default defineEventHandler(async (event) => {
  appendFileSync(process.env.NUXT_MULTI_APP_TEST_REQUESTS!, `${event.path}\n`)
  if (getHeader(event, "x-test-client") !== "1") {
    setResponseStatus(event, 503)
    return "worker middleware"
  }
  const response = await event.context.nuxtMultiApp.dispatch(
    "api",
    new Request("http://ignored.example/api/backend"),
    { signal: event.context.nuxtMultiApp.signal },
  )
  event.context.backend = await response.text()
})
