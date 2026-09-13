export default defineEventHandler((event) => ({
  app: event.context.nuxtMultiApp.appId,
  owner: true,
}))
