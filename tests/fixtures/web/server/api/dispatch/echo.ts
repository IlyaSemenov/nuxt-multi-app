export default defineEventHandler(async (event) => {
  const headers = new Headers({ "content-type": "application/json", "x-owner": "web" })
  headers.append("set-cookie", "owner-a=1; Path=/")
  headers.append("set-cookie", "owner-b=2; Path=/")
  return new Response(
    JSON.stringify({
      app: event.context.nuxtMultiApp.appId,
      host: getHeader(event, "host"),
      cookie: getHeader(event, "cookie"),
      body: await readRawBody(event),
      generation: dispatchState.generation,
    }),
    { headers },
  )
})
