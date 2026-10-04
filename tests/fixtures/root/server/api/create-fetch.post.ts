export default defineEventHandler(async (event) => {
  const fetchWeb = event.context.nuxtMultiApp.createFetch("web", {
    inheritRequestHeaders: ["cookie", "host"],
    forwardResponseHeaders: ["set-cookie"],
  })
  const response = await fetchWeb(new URL("/api/dispatch/echo", getRequestURL(event)), {
    method: "POST",
    headers: { "content-type": getHeader(event, "content-type") ?? "text/plain" },
    body: await readRawBody(event),
  })
  // Only forwarded headers reach the caller: the handler returns the body, not the response.
  return response.json()
})
