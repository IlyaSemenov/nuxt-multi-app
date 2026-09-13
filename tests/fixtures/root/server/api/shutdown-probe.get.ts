export default defineEventHandler(async (event) => {
  await new Promise((resolve) => setTimeout(resolve, 500))
  const response = await event.context.nuxtMultiApp.dispatch(
    "web",
    new Request("http://internal/api/marker"),
  )
  return { dispatchStatus: response.status }
})
