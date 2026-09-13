export default defineEventHandler((event) => ({
  app: event.context.nuxtMultiApp.appId,
  host: getHeader(event, "host"),
  revision: "ROOT_SERVER_0",
}))
