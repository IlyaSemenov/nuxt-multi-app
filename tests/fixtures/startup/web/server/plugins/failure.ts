export default defineNitroPlugin(() => {
  switch (process.env.NUXT_MULTI_APP_TEST_WORKER_FAILURE) {
    case "exit-0":
      process.exit(0)
    case "exit-1":
      process.exit(1)
    case "error":
      throw Object.assign(new Error("Worker startup failed"), { statusCode: 503 })
  }
})
