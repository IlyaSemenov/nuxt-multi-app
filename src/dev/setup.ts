import type { Server } from "node:http"

import type { Nuxt } from "nuxt/schema"

import { inlineViteBridge } from "../nuxt/compat"
import { configureNuxtApp } from "../nuxt/configure"
import type { NormalizedModuleOptions } from "../options"
import { createChild, type Child } from "./child"
import { createGateway } from "./gateway"
import { setupHmr } from "./hmr"
import { loadDevModules } from "./modules"
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
      createChild(app, { root: nuxt, ids, gateway, fallback, debug: options.debug }),
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

async function startChildren(children: Child[], server: Server) {
  // Serialize Nuxt loads; each child's worker readiness completes independently afterwards.
  for (const child of children) {
    try {
      await child.start(server)
    } catch {
      // The child records its failure for readiness and state responses; continue with other apps.
    }
  }
}
