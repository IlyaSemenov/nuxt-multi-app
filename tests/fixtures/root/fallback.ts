import { defineMultiAppFallback } from "nuxt-multi-app"

export default defineMultiAppFallback(() => (reason, _request, response) => {
  response.setHeader("x-nuxt-multi-app-test-fallback", reason.type)
  if (reason.type === "unmatched") {
    response.statusCode = 404
    response.end("No Nuxt application matches this request")
    return
  }
  if (reason.type === "starting" || reason.type === "closing") {
    response.statusCode = 503
    response.setHeader("retry-after", "1")
    response.end(`Nuxt application ${reason.appId} is ${reason.type}`)
    return
  }
  response.statusCode = 500
  response.end(
    reason.type === "failed"
      ? `Nuxt application ${reason.appId} failed to start`
      : "Nuxt application routing failed",
  )
})
