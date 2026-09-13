export default defineEventHandler(async (event) => {
  return event.context.nuxtMultiApp.dispatch(
    "web",
    new Request("http://ignored.example/api/marker", {
      headers: { host: getHeader(event, "host") ?? "" },
    }),
    { signal: event.context.nuxtMultiApp.signal },
  )
})
