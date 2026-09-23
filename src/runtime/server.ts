import { AsyncLocalStorage } from "node:async_hooks"
import { readFile } from "node:fs/promises"
import type { IncomingMessage, RequestListener, ServerResponse } from "node:http"
import { createServer } from "node:http"
import process from "node:process"

import { assertDispatchTarget, localFetch } from "./dispatch"
import { loadFactory } from "./factories"
import type {
  NitroRuntime,
  ProductionManifest,
  ProductionRuntime,
  UpgradeHandler,
} from "./registry"
import { runtimeSymbol } from "./registry"
import { requestPath, sendReadiness } from "./request"
import {
  mapResolvers,
  normalizeHost,
  resolverLabel,
  selectApplication,
  type MultiAppResolver,
} from "./routing"
import { defaultStateHandler, STATE_HANDLER_LABEL, type MultiAppStateHandler } from "./state"

interface App {
  id: string
  handler: RequestListener
  nitro: NitroRuntime
  upgrade?: UpgradeHandler
  /** Values of the shared Nitro globals as importing this application left them. */
  globals: Record<string, unknown>
}

const manifest = JSON.parse(
  await readFile(new URL("../nuxt-multi-app/manifest.json", import.meta.url), "utf8"),
) as ProductionManifest
const ids = manifest.apps.map(({ id }) => id)
const routing = await mapResolvers(manifest.routing, (resolver, index) =>
  loadFactory<MultiAppResolver>(new URL(resolver, import.meta.url).href, resolverLabel(index)),
)
const stateHandler = manifest.stateHandler
  ? await loadFactory<MultiAppStateHandler>(
      new URL(manifest.stateHandler, import.meta.url).href,
      STATE_HANDLER_LABEL,
    )
  : defaultStateHandler

const context = new AsyncLocalStorage<App>()
const globals = globalThis as unknown as Record<string, unknown>
const sharedGlobals = ["$fetch", "_importMeta_"]
// Every Nitro bundle assigns these globals while it is imported. Keep the latest assignment as the
// import-time value, and let request scopes read the snapshot captured for their own application.
const latest = new Map(sharedGlobals.map((name) => [name, globals[name]]))
for (const name of sharedGlobals) {
  Object.defineProperty(globalThis, name, {
    configurable: true,
    get: () => context.getStore()?.globals[name] ?? latest.get(name),
    set: (value: unknown) => latest.set(name, value),
  })
}

const apps: App[] = []
const appsById = new Map<string, App>()
const registrations = new Map<string, { nitro: NitroRuntime; upgrade?: UpgradeHandler }>()
let closing = false
const shutdown = new AbortController()
const activeRequests = new Set<object>()
const activeDispatches = new Set<object>()
const idleWaiters = new Set<() => void>()

const runtime: ProductionRuntime = {
  register(id, nitro, upgrade) {
    if (!ids.includes(id))
      throw new Error(`nuxt-multi-app: unexpected Nitro registration for ${id}`)
    registrations.set(id, { nitro, upgrade })
  },
  async dispatch(targetId, request, options = {}) {
    assertDispatchTarget(ids, targetId)
    const target = appsById.get(targetId)
    if (closing || !target) {
      return new Response(null, { status: 503, headers: { "retry-after": "1" } })
    }
    const signal = options.signal
      ? AbortSignal.any([options.signal, shutdown.signal])
      : shutdown.signal
    const marker = {}
    activeDispatches.add(marker)
    try {
      const response = await context.run(target, () =>
        localFetch(target.nitro, request, { signal }),
      )
      return trackResponse(response, () => finishDispatch(marker))
    } catch (error) {
      finishDispatch(marker)
      throw error
    }
  },
}
;(globalThis as Record<symbol, unknown>)[runtimeSymbol] = runtime

for (const definition of manifest.apps) {
  const module = (await import(new URL(definition.entry, import.meta.url).href)) as {
    handler?: unknown
    listener?: unknown
  }
  const handler = module.handler ?? module.listener
  if (typeof handler !== "function") {
    throw new TypeError(`nuxt-multi-app: ${definition.id} was built without a Node handler`)
  }
  // The bundle registers its Nitro instance through the plugin while it is imported.
  const registration = registrations.get(definition.id)
  if (!registration) {
    throw new TypeError(`nuxt-multi-app: ${definition.id} did not register its Nitro runtime`)
  }
  const app: App = {
    id: definition.id,
    handler: handler as RequestListener,
    ...registration,
    // Importing the bundle left its own $fetch and import.meta bridge in `latest`; freeze them now.
    globals: Object.fromEntries(sharedGlobals.map((name) => [name, latest.get(name)])),
  }
  apps.push(app)
  appsById.set(app.id, app)
}

const choose = (request: IncomingMessage) => selectApplication(apps, routing, request)

const server = createServer((request, response) => {
  if (manifest.readinessPath && requestPath(request) === manifest.readinessPath) {
    const state = closing ? "closing" : "ready"
    sendReadiness(response, Object.fromEntries(apps.map((app) => [app.id, state])), manifest.debug)
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
        return stateHandler(
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
    .catch((error) => stateHandler({ type: "resolver-error", error }, request, response))
    .catch((error) => fail(response, error))
})

server.on("upgrade", (request, socket, head) => {
  void choose(request)
    .then((app) => {
      const upgrade = app?.upgrade
      if (!app || !upgrade || closing) {
        socket.destroy()
        return
      }
      return context.run(app, () => upgrade(request, socket, head))
    })
    .catch((error) => {
      // A peer that leaves during the upgrade destroys the socket itself; only report live failures.
      if (!socket.destroyed) console.error("[nuxt-multi-app] WebSocket routing failed", error)
      socket.destroy()
    })
})

function fail(response: ServerResponse, error: unknown) {
  console.error("[nuxt-multi-app]", error)
  if (response.headersSent) response.destroy(error as Error)
  else {
    response.statusCode = 500
    response.end("Nuxt application routing failed")
  }
}

// A dispatch remains active until its body is consumed or cancelled, not merely until headers arrive.
function trackResponse(response: Response, done: () => void) {
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
  const body = new ReadableStream<Uint8Array>({
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

function finishDispatch(marker: object) {
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
  return new Promise<boolean>((resolve) => idleWaiters.add(() => resolve(true)))
}

let shutdownStarted = false
for (const signal of ["SIGINT", "SIGTERM"] as const) {
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
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), manifest.shutdownTimeout)
  })
  const drained = await Promise.race([waitForIdle(), timeout])
  clearTimeout(timer)
  if (!drained) {
    shutdown.abort(new Error("nuxt-multi-app: graceful shutdown timed out"))
    server.closeAllConnections()
  }
  for (const app of [...apps].reverse()) {
    await context.run(app, () => app.nitro.hooks.callHook("close"))
  }
  delete (globalThis as Record<symbol, unknown>)[runtimeSymbol]
  process.exit(0)
}

// Same precedence as Nitro's node-server preset.
const port = Number(process.env.NITRO_PORT || process.env.PORT) || 3000
const host = process.env.NITRO_HOST || process.env.HOST
server.listen(port, host, () => {
  const address = server.address()
  const origin =
    typeof address === "string" || !address
      ? String(address)
      : `http://${address.address}:${address.port}`
  console.log(`[nuxt-multi-app] listening on ${origin}; PID=${process.pid}`)
  console.log(`[nuxt-multi-app] routing: ${routing.length} ordered rules`)
  for (const [index, rule] of routing.entries()) {
    const guards = [
      rule.hosts && `hosts ${rule.hosts.join(", ")}`,
      rule.paths && `paths ${rule.paths.join(", ")}`,
    ]
      .filter(Boolean)
      .join(" and ")
    const target = "app" in rule ? rule.app : "resolver"
    console.log(`[nuxt-multi-app] rule ${index + 1}: ${guards || "*"} -> ${target}`)
  }
})
