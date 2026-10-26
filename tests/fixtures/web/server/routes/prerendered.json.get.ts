// The mounted composition prerenders this route during `nuxt build`, where only this application runs.
export default defineEventHandler(async (event) => {
  const { appId, dispatch } = event.context.nuxtMultiApp
  const self = await dispatch(appId, new Request(new URL("/api/owner", getRequestURL(event))))
  const other = await dispatch("root", new Request(new URL("/api/marker", getRequestURL(event))))
    .then(() => "dispatched")
    .catch((error: Error) => error.message)
  return { app: appId, self: await self.json(), other }
})
