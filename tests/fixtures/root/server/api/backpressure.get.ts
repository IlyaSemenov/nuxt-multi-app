export default defineEventHandler(async (event) => {
  const first = await event.context.nuxtMultiApp.dispatch(
    "web",
    new Request("http://internal/api/dispatch/stream"),
    { signal: event.context.nuxtMultiApp.signal },
  )
  const reader = first.body!.getReader()
  await reader.read()
  await new Promise((resolve) => setTimeout(resolve, 250))
  const during = await event.context.nuxtMultiApp
    .dispatch("web", new Request("http://internal/api/dispatch/state"))
    .then((response) => response.json())
  await reader.cancel()

  const complete = await event.context.nuxtMultiApp.dispatch(
    "web",
    new Request("http://internal/api/dispatch/stream"),
  )
  await complete.arrayBuffer()
  const after = await event.context.nuxtMultiApp
    .dispatch("web", new Request("http://internal/api/dispatch/state"))
    .then((response) => response.json())
  return { producedAtFirstRead: during.produced, producedAfterComplete: after.produced }
})
