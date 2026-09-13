import { AsyncLocalStorage } from "node:async_hooks"
import { readFile } from "node:fs/promises"
import { createServer } from "node:http"
import process from "node:process"

import { initializeResolver, initializeStateHandler } from "./factories.mjs"
import { internalPath, requestPath } from "./request.mjs"
import { normalizeHost, selectApplication } from "./routing.mjs"
import { defaultStateHandler } from "./state.mjs"

const manifest = JSON.parse(await readFile(new URL("./manifest.json", import.meta.url), "utf8"))
const resolverFactory = manifest.resolver
  ? await import(new URL(manifest.resolver, import.meta.url)).then((module) => module.default)
  : undefined
const stateHandlerFactory = manifest.stateHandler
  ? await import(new URL(manifest.stateHandler, import.meta.url)).then((module) => module.default)
  : undefined
if (resolverFactory && typeof resolverFactory !== "function") {
  throw new TypeError("nuxt-multi-app: resolver module must default-export a factory function")
}
if (stateHandlerFactory && typeof stateHandlerFactory !== "function") {
  throw new TypeError("nuxt-multi-app: state-handler module must default-export a factory function")
}

const context = new AsyncLocalStorage()
const sharedGlobals = ["$fetch", "_importMeta_"]
// Nitro bundles assign these globals while they are imported. Keep the latest assignment as the
// current import snapshot, while request scopes read the snapshot captured for their target app.
const latest = new Map(sharedGlobals.map((name) => [name, globalThis[name]]))
for (const name of sharedGlobals) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => context.getStore()?.globals[name] ?? latest.get(name),
    set: (value) => latest.set(name, value),
  })
}

const apps = []
const appsById = new Map()
// The Nitro plugin discovers this process-wide registry while each application bundle initializes.
const runtimeSymbol = Symbol.for("nuxt-multi-app.runtime")
let closing = false
const shutdown = new AbortController()
const activeDispatches = new Set()
const idleWaiters = new Set()
const resolver = resolverFactory
  ? await initializeResolver(
      resolverFactory,
      manifest.apps.map(({ id }) => id),
    )
  : undefined
const stateHandler = stateHandlerFactory
  ? await initializeStateHandler(
      stateHandlerFactory,
      manifest.apps.map(({ id }) => id),
    )
  : defaultStateHandler

const runtime = {
  register(id, nitro, upgrade) {
    const app = appsById.get(id)
    if (!app) throw new Error(`nuxt-multi-app: unexpected Nitro registration for ${id}`)
    app.nitro = nitro
    app.upgrade = upgrade
  },
  async dispatch(_callerId, targetId, request, options = {}) {
    const target = appsById.get(targetId)
    if (!target) throw new Error(`nuxt-multi-app: dispatch target ${targetId} is not registered`)
    if (closing || !target.nitro) {
      return new Response(null, { status: 503, headers: { "retry-after": "1" } })
    }
    const signal = options.signal
      ? AbortSignal.any([options.signal, shutdown.signal])
      : shutdown.signal
    const marker = {}
    activeDispatches.add(marker)
    try {
      const response = await context.run(target, () =>
        target.nitro.localFetch(internalPath(request), {
          method: request.method,
          headers: request.headers,
          ...(request.body && request.method !== "GET" && request.method !== "HEAD"
            ? { body: request.body, duplex: "half" }
            : {}),
          context: { _platform: { nuxtMultiAppDispatchSignal: signal } },
        }),
      )
      return trackResponse(response, () => finishDispatch(marker))
    } catch (error) {
      finishDispatch(marker)
      throw error
    }
  },
}
globalThis[runtimeSymbol] = runtime

for (const definition of manifest.apps) {
  const app = {
    ...definition,
    handler: undefined,
    nitro: undefined,
    upgrade: undefined,
    globals: {},
  }
  apps.push(app)
  appsById.set(app.id, app)
  const module = await import(new URL(app.entry, import.meta.url).href)
  app.handler = module.handler ?? module.listener
  if (typeof app.handler !== "function") {
    throw new TypeError(`nuxt-multi-app: ${app.id} was built without a Node handler`)
  }
  if (!app.nitro) {
    throw new TypeError(`nuxt-multi-app: ${app.id} did not register its Nitro runtime`)
  }
  // Importing an app leaves its $fetch and import-meta bridge in `latest`; freeze that pair now.
  app.globals = Object.fromEntries(sharedGlobals.map((name) => [name, latest.get(name)]))
}

const choose = (request) => selectApplication(apps, manifest.fallback, resolver, request)

const activeRequests = new Set()
const server = createServer((request, response) => {
  if (manifest.readinessPath && requestPath(request) === manifest.readinessPath) {
    response.statusCode = closing ? 503 : 200
    response.setHeader("content-type", "application/json; charset=utf-8")
    response.setHeader("cache-control", "no-store")
    response.end(
      JSON.stringify({
        ready: !closing,
        apps: manifest.debug
          ? Object.fromEntries(apps.map((app) => [app.id, closing ? "closing" : "ready"]))
          : undefined,
      }),
    )
    return
  }
  const marker = {}
  activeRequests.add(marker)
  const finish = () => {
    activeRequests.delete(marker)
    notifyIdle()
  }
  response.once("finish", finish)
  response.once("close", finish)
  void choose(request)
    .then((app) => {
      if (!app) {
        return handleState(
          { type: "unmatched", host: normalizeHost(request.headers.host) },
          request,
          response,
        )
      }
      if (manifest.debug && request.headers.accept?.includes("text/html")) {
        console.log(`[nuxt-multi-app] ${request.headers.host ?? ""} -> ${app.id}`)
      }
      return context.run(app, () => app.handler(request, response))
    })
    .catch((error) => handleState({ type: "resolver-error", error }, request, response))
    .catch((error) => fail(response, error))
})

server.on("upgrade", (request, socket, head) => {
  void choose(request)
    .then((app) => {
      if (!app?.upgrade || closing) {
        socket.destroy()
        return
      }
      return context.run(app, () => app.upgrade(request, socket, head))
    })
    .catch((error) => {
      console.error("[nuxt-multi-app] WebSocket routing failed", error)
      socket.destroy()
    })
})

async function handleState(state, request, response) {
  return stateHandler(state, request, response)
}

function fail(response, error) {
  console.error("[nuxt-multi-app]", error)
  if (response.headersSent) response.destroy(error)
  else {
    response.statusCode = 500
    response.end("Nuxt application routing failed")
  }
}

// A dispatch remains active until its body is consumed or cancelled, not merely until headers arrive.
function trackResponse(response, done) {
  if (!response.body) {
    done()
    return response
  }
  const reader = response.body.getReader()
  let finished = false
  const finish = () => {
    if (finished) return
    finished = true
    done()
  }
  const body = new ReadableStream({
    async pull(controller) {
      try {
        const result = await reader.read()
        if (result.done) {
          finish()
          controller.close()
        } else controller.enqueue(result.value)
      } catch (error) {
        finish()
        controller.error(error)
      }
    },
    async cancel(reason) {
      finish()
      await reader.cancel(reason)
    },
  })
  return new Response(body, response)
}

function finishDispatch(marker) {
  activeDispatches.delete(marker)
  notifyIdle()
}

function notifyIdle() {
  if (activeRequests.size || activeDispatches.size) return
  for (const resolve of idleWaiters) resolve()
  idleWaiters.clear()
}

// Shutdown waits on both public responses and fully consumed internal dispatch responses.
function waitForIdle() {
  if (!activeRequests.size && !activeDispatches.size) return Promise.resolve(true)
  return new Promise((resolve) => idleWaiters.add(() => resolve(true)))
}

let shutdownStarted = false
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (shutdownStarted) return
    shutdownStarted = true
    void close().catch((error) => {
      console.error("[nuxt-multi-app] shutdown failed", error)
      process.exit(1)
    })
  })
}

async function close() {
  closing = true
  server.close()
  server.closeIdleConnections()
  let timeoutId
  const timeout = new Promise((resolve) => {
    timeoutId = setTimeout(() => resolve(false), manifest.shutdownTimeout)
  })
  const drained = await Promise.race([waitForIdle(), timeout])
  clearTimeout(timeoutId)
  if (!drained) {
    shutdown.abort(new Error("nuxt-multi-app: graceful shutdown timed out"))
    server.closeAllConnections()
  }
  for (const app of [...apps].reverse()) {
    await context.run(app, () => app.nitro.hooks.callHook("close"))
  }
  delete globalThis[runtimeSymbol]
  process.exit(0)
}

const port = Number(process.env.PORT ?? process.env.NITRO_PORT ?? 3000)
const host = process.env.HOST ?? process.env.NITRO_HOST
server.listen(port, host, () => {
  const address = server.address()
  const origin = typeof address === "string" ? address : `http://${address.address}:${address.port}`
  console.log(`[nuxt-multi-app] listening on ${origin}; PID=${process.pid}`)
  const hasHosts = apps.some((app) => app.hosts.length)
  console.log(
    `[nuxt-multi-app] routing: ${resolver ? (hasHosts ? "resolver-and-hosts" : "resolver") : "hosts"}`,
  )
  for (const app of apps) {
    if (app.hosts.length) console.log(`[nuxt-multi-app] ${app.hosts.join(", ")} -> ${app.id}`)
  }
  console.log(
    manifest.fallback === false
      ? "[nuxt-multi-app] no resolver or host match -> 404"
      : `[nuxt-multi-app] no resolver or host match -> ${manifest.fallback}`,
  )
})
