export default defineEventHandler((event) => ({
  app: event.context.nuxtMultiApp.appId,
  host: getHeader(event, "host"),
  revision: "WEB_SERVER_0",
}))
