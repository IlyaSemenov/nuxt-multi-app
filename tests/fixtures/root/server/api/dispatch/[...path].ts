export default defineEventHandler((event) =>
  event.context.nuxtMultiApp.dispatch("web", toWebRequest(event), {
    signal: event.context.nuxtMultiApp.signal,
  }),
)
