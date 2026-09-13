export default defineEventHandler(async (event) => ({
  app: event.context.nuxtMultiApp.appId,
  marker: await $fetch("/api/marker"),
}))
