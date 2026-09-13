import type { RequestListener, Server } from "node:http"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { Nuxt } from "nuxt/schema"

import { setupProductionBuild } from "./build"
import { bundleProjectModule } from "./bundle"
import type { ChildState } from "./child"
import { createChild } from "./child"
import { setupDevAdapter } from "./compat"
import { configureNuxtApp } from "./configure-app"
import { installDevRouting, type DevEndpoint } from "./dev-routing"
import { createGateway, type GatewayTarget } from "./gateway"
import { normalizeOptions } from "./normalize-options"
import type { ModuleOptions, MultiAppResolverFactory, MultiAppStateHandlerFactory } from "./options"
import { MODULE_OUTPUT_DIR } from "./options"
import { prepareChildren } from "./prepare"
import { initializeResolver, initializeStateHandler } from "./runtime/factories.mjs"
import { defaultStateHandler } from "./runtime/state.mjs"

/** Run the Nuxt module lifecycle for prepare, development, or production build. */
export async function setupModule(input: ModuleOptions, nuxt: Nuxt) {
  const options = normalizeOptions(input, nuxt)
  const ids = options.allApps.map((app) => app.id)
  const projectModules = [options.resolver, options.stateHandler].filter(
    (path): path is string => path !== undefined,
  )
  nuxt.options.watch.push(...projectModules)

  if (nuxt.options._prepare) {
    configureNuxtApp(nuxt, options.root, { ids, projectModules })
    await prepareChildren(options)
    return
  }

  if (!nuxt.options.dev) {
    configureNuxtApp(nuxt, options.root, { ids, projectModules })
    setupProductionBuild(options, nuxt)
    return
  }

  const endpoints = new Map<string, DevEndpoint>()
  const gateway = createGateway((id) => endpoints.get(id) as GatewayTarget | undefined)
  await gateway.listen()
  configureNuxtApp(nuxt, options.root, {
    ids,
    gateway: gateway.address,
    token: gateway.token,
    projectModules,
  })
  const rootAdapter = setupDevAdapter(nuxt, options.root.id)
  nuxt.hook("nitro:init", (nitro) => {
    nitro.hooks.hook("dev:reload", () => gateway.invalidate(options.root.id))
  })
  let rootState: ChildState = { type: "starting" }
  const rootEndpoint: DevEndpoint = {
    options: options.root,
    get state() {
      return rootState
    },
    // installMultiplexer replaces this before the public listener can dispatch a request.
    handle: (() => {
      throw new Error("nuxt-multi-app: root listener is not installed")
    }) as RequestListener,
    upgrade: () => undefined,
  }
  endpoints.set(options.root.id, rootEndpoint)

  let children: ReturnType<typeof createChild>[] = []
  let publicServer: Server | undefined
  let devRouting: ReturnType<typeof installDevRouting> | undefined
  nuxt.hook("listen", async (server: Server) => {
    publicServer = server
    rootAdapter.attach(server)
    const [resolver, stateHandler] = await loadDevModules(options, nuxt)
    children = options.apps.map((app) =>
      createChild(app, nuxt, ids, gateway, stateHandler, options.debug),
    )
    for (const child of children) endpoints.set(child.id, child)
    devRouting = installDevRouting(
      server,
      [rootEndpoint, ...children],
      rootAdapter.upgrade,
      resolver,
      stateHandler,
      options.fallback,
      options.readinessPath,
      options.debug,
    )
  })

  nuxt.hook("ready", () => {
    nuxt.hook("build:done", () => {
      rootState = { type: "ready" }
      if (publicServer) void startChildren(children, publicServer)
    })
  })
  nuxt.hook("close", async () => {
    rootState = { type: "closing" }
    await Promise.all([
      gateway.close(options.shutdownTimeout),
      ...children.map((child) => child.close()),
    ])
    devRouting?.dispose()
  })
}

async function loadDevModules(options: ReturnType<typeof normalizeOptions>, nuxt: Nuxt) {
  const output = resolve(nuxt.options.buildDir, MODULE_OUTPUT_DIR)
  const resolverFactory = options.resolver
    ? await bundleAndImport<MultiAppResolverFactory>(
        options.resolver,
        resolve(output, "resolver.mjs"),
        nuxt,
      )
    : undefined
  const resolver = resolverFactory
    ? await initializeResolver(
        resolverFactory,
        options.allApps.map(({ id }) => id),
      )
    : undefined
  const stateHandlerFactory = options.stateHandler
    ? await bundleAndImport<MultiAppStateHandlerFactory>(
        options.stateHandler,
        resolve(output, "state-handler.mjs"),
        nuxt,
      )
    : undefined
  const stateHandler = stateHandlerFactory
    ? await initializeStateHandler(
        stateHandlerFactory,
        options.allApps.map(({ id }) => id),
      )
    : defaultStateHandler
  return [resolver, stateHandler] as const
}

async function bundleAndImport<T>(input: string, output: string, nuxt: Nuxt): Promise<T> {
  await bundleProjectModule(input, output, nuxt)
  const module = await import(`${pathToFileURL(output).href}?t=${Date.now()}`)
  if (typeof module.default !== "function") {
    throw new TypeError(`nuxt-multi-app: ${input} must have a default function export`)
  }
  return module.default as T
}

async function startChildren(children: ReturnType<typeof createChild>[], server: Server) {
  for (const child of children) {
    try {
      await child.start(server)
    } catch {
      // The child records its failure for readiness and state responses; continue with other apps.
    }
  }
}
