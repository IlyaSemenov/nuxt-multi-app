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
import type {
  ModuleOptions,
  MultiAppResolver,
  MultiAppStateHandler,
  NormalizedModuleOptions,
  ProjectModule,
} from "./options"
import { MODULE_OUTPUT_DIR, PROJECT_MODULES } from "./options"
import { prepareChildren } from "./prepare"
import { loadFactory } from "./runtime/factories"
import { defaultStateHandler } from "./runtime/state"

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
    const [resolver, stateHandler] = await loadDevModules(options, ids, nuxt)
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
    // Nitro starts the root dev worker from a `build:done` hook it registers while Nuxt becomes
    // ready; registering afterwards starts children only once the root can serve requests.
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

async function loadDevModules(options: NormalizedModuleOptions, ids: string[], nuxt: Nuxt) {
  const outputDir = resolve(nuxt.options.buildDir, MODULE_OUTPUT_DIR)
  async function load<T extends (...args: never[]) => unknown>(
    input: string,
    module: ProjectModule,
  ) {
    const output = resolve(outputDir, module.file)
    await bundleProjectModule(input, output, nuxt)
    // The query defeats the ESM cache, so a full Nuxt restart imports the freshly bundled module.
    return loadFactory<T>(`${pathToFileURL(output).href}?t=${Date.now()}`, ids, module.name)
  }
  const resolver = options.resolver
    ? await load<MultiAppResolver>(options.resolver, PROJECT_MODULES.resolver)
    : undefined
  const stateHandler = options.stateHandler
    ? await load<MultiAppStateHandler>(options.stateHandler, PROJECT_MODULES.stateHandler)
    : defaultStateHandler
  return [resolver, stateHandler] as const
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
