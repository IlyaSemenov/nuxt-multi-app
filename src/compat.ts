import type { Buffer } from "node:buffer"
import type { IncomingMessage, Server } from "node:http"
import { createServer } from "node:http"
import { dirname, resolve } from "node:path"
import process from "node:process"
import type { Duplex } from "node:stream"
import { fileURLToPath } from "node:url"

import type {} from "@nuxt/nitro-server"
import { toNodeListener } from "h3"
import MagicString from "magic-string"
import type { Nuxt } from "nuxt/schema"
import { satisfies } from "semver"

const SUPPORTED_NUXT = "~4.5.2"

/** Reject Nuxt releases outside the range covered by the private-API adapter. */
export function assertSupportedNuxt(nuxt: Nuxt) {
  if (!satisfies(nuxt._version, SUPPORTED_NUXT)) {
    throw new Error(`nuxt-multi-app: unsupported Nuxt ${nuxt._version}; expected ${SUPPORTED_NUXT}`)
  }
}

/** Apply the version-specific Nuxt and Nitro development-server adaptations. */
export function setupDevAdapter(nuxt: Nuxt, id: string) {
  assertSupportedNuxt(nuxt)

  // Nitro workers must retain the Vite bridge belonging to their own Nuxt instance after reload.
  nuxt.hook("nitro:build:before", (nitro) => {
    const options = process.env.NUXT_VITE_NODE_OPTIONS
    if (!options || JSON.parse(options).root !== nuxt.options.srcDir) {
      throw new Error(`nuxt-multi-app: Vite bridge belongs to another application (${id})`)
    }
    // Match the aliased import below; leaving this dynamic lets a reloaded worker use a child's IPC.
    nitro.options.replace["__nuxtMultiAppProcess.env.NUXT_VITE_NODE_OPTIONS"] =
      JSON.stringify(options)
    const bridge = /\/@nuxt\/vite-builder\/dist\/vite-node(?:-entry|-runner)?\.mjs$/
    const bridgeImport = /^#vite-node(?:-entry|-runner)?$/
    const bridgeDir = dirname(nitro.options.alias["#vite-node"]!)
    nitro.options.externals.inline ??= []
    nitro.options.externals.inline.push(bridge)
    if (!nitro.options.rollupConfig) {
      throw new Error("nuxt-multi-app: Nitro rollupConfig is missing")
    }
    nitro.options.rollupConfig.plugins = [
      nitro.options.rollupConfig.plugins,
      {
        name: "nuxt-multi-app:inline-vite-bridge",
        resolveId: {
          order: "pre",
          handler(source: string) {
            if (bridgeDir && bridgeImport.test(source)) {
              return resolve(bridgeDir, `${source.slice(1)}.mjs`)
            }
            if (source.startsWith("file:") && bridge.test(source)) return fileURLToPath(source)
          },
        },
        transform: {
          order: "pre",
          handler(code: string, id: string) {
            if (!bridge.test(id)) return
            const processImport = /^import process from (["'])node:process\1;?/m.exec(code)
            if (!processImport) {
              throw new Error(`nuxt-multi-app: Vite bridge process import changed (${id})`)
            }
            const transformed = new MagicString(code)
            // Nitro injects its own `process` import when rendering chunks containing import.meta.
            transformed.overwrite(
              processImport.index,
              processImport.index + processImport[0].length,
              'import __nuxtMultiAppProcess from "node:process";',
            )
            for (const match of code.matchAll(/\bprocess\b/g)) {
              if (
                match.index >= processImport.index &&
                match.index < processImport.index + processImport[0].length
              ) {
                continue
              }
              transformed.overwrite(
                match.index,
                match.index + "process".length,
                "__nuxtMultiAppProcess",
              )
            }
            return {
              code: transformed.toString(),
              map: transformed.generateMap({ hires: true }).toString(),
            }
          },
        },
      },
    ]
    const external = nitro.options.rollupConfig.external
    if (typeof external !== "function") {
      throw new TypeError("nuxt-multi-app: the ViteNodePlugin external contract changed")
    }
    nitro.options.rollupConfig.external = (source, importer, resolved) =>
      bridge.test(source) || bridgeImport.test(source)
        ? false
        : external(source, importer, resolved)
  })

  const transport = createServer()
  let publicServer: Server
  function attach(server: Server) {
    publicServer = server
  }

  nuxt.hook("vite:extendConfig", (config, { isClient }) => {
    if (!isClient) return
    const address = publicServer.address()
    if (!address || typeof address === "string") {
      throw new Error("nuxt-multi-app: an external TCP listener is required for Vite HMR")
    }
    if (!config.server) throw new Error("nuxt-multi-app: Vite server config is missing")
    config.server.hmr = {
      ...(typeof config.server.hmr === "object" ? config.server.hmr : {}),
      server: transport,
      path: `nuxt-multi-app/${id}/hmr`,
      clientPort: address.port,
    }
  })

  return {
    transport,
    attach,
    upgrade(request: IncomingMessage, socket: Duplex, head: Buffer) {
      transport.emit("upgrade", request, socket, head)
    },
  }
}

/** Restart a mounted child when its loaded Nuxt or layer configuration changes. */
export function watchChildConfig(nuxt: Nuxt) {
  // Mounted instances have no CLI config watcher; the builder owns these watches and their cleanup.
  for (const file of [
    ...nuxt.options._nuxtConfigFiles,
    ...nuxt.options._layers.map((layer) => layer.configFile),
  ]) {
    if (file && !nuxt.options.watch.includes(file)) nuxt.options.watch.push(file)
  }
}

/** Return the current Nitro development request listener. */
export function getDevHandler(nuxt: Nuxt) {
  if (!nuxt.server || !("app" in nuxt.server)) {
    throw new Error("nuxt-multi-app: Nitro 2 development app is missing")
  }
  return toNodeListener(nuxt.server.app)
}

/** Return Nitro's application WebSocket upgrade handler when it is available. */
export function getDevUpgrade(nuxt: Nuxt) {
  const server = nuxt.server as typeof nuxt.server & {
    upgrade?: (
      request: import("node:http").IncomingMessage,
      socket: import("node:stream").Duplex,
      head: Buffer,
    ) => unknown
  }
  return typeof server?.upgrade === "function" ? server.upgrade.bind(server) : undefined
}
