export default defineNitroPlugin(() => {
  if (process.env.NUXT_MULTI_APP_TEST_WORKER_FAILURE) {
    throw Object.assign(new Error("Worker startup failed"), { statusCode: 503 })
  }
})
