export default defineEventHandler(async (event) => {
  const fetchWeb = event.context.nuxtMultiApp.createFetch("web", {
    inheritRequestHeaders: ["cookie", "host"],
  })
  return fetchWeb(new URL("/api/dispatch/echo", getRequestURL(event)), {
    method: "POST",
    headers: { "content-type": getHeader(event, "content-type") ?? "text/plain" },
    body: await readRawBody(event),
  })
})
