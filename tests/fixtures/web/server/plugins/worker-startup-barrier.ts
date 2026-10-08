import { existsSync, writeFileSync } from "node:fs"

// Hold the first Nitro worker's initialization until the integration test releases it, past the time
// Nitro itself waits for a worker before answering 503.
export default defineNitroPlugin(() => {
  const barrier = process.env.NUXT_MULTI_APP_TEST_WORKER_STARTUP_BARRIER
  if (!barrier || existsSync(`${barrier}.release`)) return
  writeFileSync(`${barrier}.waiting`, "")
  // A Nitro plugin cannot defer the worker asynchronously, so block its thread the way slow initialization would.
  const pause = new Int32Array(new SharedArrayBuffer(4))
  while (!existsSync(`${barrier}.release`)) Atomics.wait(pause, 0, 0, 50)
})
