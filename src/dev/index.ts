import type { Server } from "node:http"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"

import type { Nuxt } from "nuxt/schema"

import { bundleProjectModule } from "../bundle"
import { FALLBACK_FILE, moduleBuildDir, resolverFile, serverDir } from "../layout"
import { inlineViteBridge } from "../nuxt/compat"
import { configureNuxtApp } from "../nuxt/configure"
import type { NormalizedModuleOptions } from "../options"
import { loadFactory } from "../runtime/factories"
import { defaultFallback, FALLBACK_LABEL, type MultiAppFallback } from "../runtime/fallback"
import { mapResolvers, resolverLabel, type MultiAppResolver } from "../runtime/routing"
import { createChild, type Child } from "./child"
import { createGateway } from "./gateway"
import { setupHmr } from "./hmr"
import { installDevRouting, type DevEndpointState } from "./routing"

/** Serve the root and every mounted child behind the Nuxt CLI listener during `nuxt dev`. */
export async function setupDevelopment(
  options: NormalizedModuleOptions,
  nuxt: Nuxt,
  { ids, projectModules }: { ids: string[]; projectModules: string[] },
) {
  let devRouting: ReturnType<typeof installDevRouting> | undefined
  // Until the public listener exists there is no endpoint to address; the gateway rejects the call.
  const gateway = createGateway((id) => devRouting?.endpoint(id))
  await gateway.listen()
  configureNuxtApp(nuxt, options.root, {
    ids,
    gateway: gateway.address,
    token: gateway.token,
    projectModules,
  })
  inlineViteBridge(nuxt, options.root.id)
  const rootHmr = setupHmr(nuxt, options.root.id)
  nuxt.hook("nitro:init", (nitro) => {
    nitro.hooks.hook("dev:reload", () => gateway.invalidate(options.root.id))
  })
  let rootState: DevEndpointState = { type: "starting" }
  let children: Child[] = []
  let publicServer: Server | undefined
  nuxt.hook("listen", async (server: Server) => {
    publicServer = server
    rootHmr.attach(server)
    const [routing, fallback] = await loadDevModules(options, nuxt)
    children = options.apps.map((app) =>
      createChild(app, nuxt, ids, gateway, fallback, options.debug),
    )
    devRouting = installDevRouting(server, {
      root: { id: options.root.id, state: () => rootState, hmr: rootHmr.upgrade },
      children,
      routing,
      fallback,
      readinessPath: options.readinessPath,
      debug: options.debug,
    })
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

async function loadDevModules(options: NormalizedModuleOptions, nuxt: Nuxt) {
  async function load<T extends (...args: never[]) => unknown>(
    input: string,
    file: string,
    label: string,
  ) {
    const output = resolve(serverDir(moduleBuildDir(nuxt.options.buildDir)), file)
    await bundleProjectModule(input, output, nuxt)
    // The query defeats the ESM cache, so a full Nuxt restart imports the freshly bundled module.
    return loadFactory<T>(`${pathToFileURL(output).href}?t=${Date.now()}`, label)
  }
  const routing = await mapResolvers(options.routing, (input, index) =>
    load<MultiAppResolver>(input, resolverFile(index), resolverLabel(index)),
  )
  const fallback = options.fallback
    ? await load<MultiAppFallback>(options.fallback, FALLBACK_FILE, FALLBACK_LABEL)
    : defaultFallback
  return [routing, fallback] as const
}

async function startChildren(children: Child[], server: Server) {
  for (const child of children) {
    try {
      await child.start(server)
    } catch {
      // The child records its failure for readiness and state responses; continue with other apps.
    }
  }
}
