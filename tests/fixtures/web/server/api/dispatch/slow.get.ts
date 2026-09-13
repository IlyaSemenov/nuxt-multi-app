export default defineEventHandler(async (event) => {
  dispatchState.slowStarted++
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 30_000)
      event.context.nuxtMultiApp.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer)
          reject(event.context.nuxtMultiApp.signal.reason)
        },
        { once: true },
      )
    })
    return "finished"
  } catch (error) {
    if (event.context.nuxtMultiApp.signal.aborted) dispatchState.cancelled++
    throw error
  }
})
