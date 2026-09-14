import { defineMultiAppStateHandler } from "nuxt-multi-app"

export default defineMultiAppStateHandler(({ appIds }) => {
  for (const id of ["root", "web"] as const) {
    if (!appIds.has(id)) throw new Error(`fixture requires application ${id}`)
  }

  return (state, _request, response) => {
    response.setHeader("x-nuxt-multi-app-test-state", state.type)
    if (state.type === "unmatched") {
      response.statusCode = 404
      response.end("No Nuxt application matches this request")
      return
    }
    if (state.type === "starting" || state.type === "closing") {
      response.statusCode = 503
      response.setHeader("retry-after", "1")
      response.end(`Nuxt application ${state.appId} is ${state.type}`)
      return
    }
    response.statusCode = 500
    response.end(
      state.type === "failed"
        ? `Nuxt application ${state.appId} failed to start`
        : "Nuxt application routing failed",
    )
  }
})
