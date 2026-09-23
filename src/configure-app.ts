import { addTypeTemplate, createResolver } from "@nuxt/kit"
import type {} from "@nuxt/nitro-server"
import type { NitroConfig } from "nitropack/types"
import type { Nuxt } from "nuxt/schema"

import { assertSupportedNuxt } from "./compat"
import type { NormalizedAppOptions } from "./options"
import type { GatewayAddress } from "./runtime/dispatch"

const resolver = createResolver(import.meta.url)
const runtimeDir = resolver.resolve("./runtime")
const runtimePlugin = resolver.resolve("./runtime/nitro-plugin")

/** Registry IDs and development gateway credentials embedded in one application's Nitro bundle. */
export interface RuntimeSettings {
  ids: string[]
  gateway?: GatewayAddress
  token?: string
  projectModules?: string[]
}

/** Add the runtime context, declarations, and isolation constraints to one Nuxt instance. */
export function configureNuxtApp(nuxt: Nuxt, app: NormalizedAppOptions, settings: RuntimeSettings) {
  assertSupportedNuxt(nuxt)
  nuxt.runWithContext(() =>
    addTypeTemplate(
      {
        filename: "types/multi-app.d.ts",
        getContents: () => appIdDeclaration(settings.ids),
      },
      { nuxt: true, node: true, nitro: true },
    ),
  )
  nuxt.options.nitro.plugins = [...(nuxt.options.nitro.plugins ?? []), runtimePlugin]
  assertIsolatedOutput(nuxt.options.nitro, app.id)

  nuxt.hook("nitro:build:before", (nitro) => {
    nitro.options.replace["process.env.NUXT_MULTI_APP_ID"] = JSON.stringify(app.id)
    // Nitro replacement values are JavaScript source; JSON-valued environment variables
    // therefore need one serialization for their value and one for the string literal.
    nitro.options.replace["process.env.NUXT_MULTI_APP_IDS"] = JSON.stringify(
      JSON.stringify(settings.ids),
    )
    nitro.options.replace["process.env.NUXT_MULTI_APP_GATEWAY"] = JSON.stringify(
      JSON.stringify(settings.gateway ?? null),
    )
    nitro.options.replace["process.env.NUXT_MULTI_APP_GATEWAY_TOKEN"] = JSON.stringify(
      settings.token ?? "",
    )
    nitro.options.externals.inline ??= []
    // Only this module depends on `crossws`, so inline the adapter instead of leaving a bare
    // external for Nitro to resolve from the application.
    nitro.options.externals.inline.push(runtimeDir, /[/\\]crossws[/\\]/)
  })

  nuxt.hook("prepare:types", ({ references, nodeReferences, nodeTsConfig }) => {
    references.push({ types: "nuxt-multi-app/runtime" })
    if (settings.projectModules?.length) {
      nodeReferences.push({ types: "node" })
      nodeTsConfig.include = [...(nodeTsConfig.include ?? []), ...settings.projectModules]
    }
  })
}

/** Generate the registry augmentation shared by resolver modules and Nitro server code. */
function appIdDeclaration(ids: string[]) {
  return [
    'import "nuxt-multi-app/runtime"',
    "",
    'declare module "nuxt-multi-app/runtime" {',
    "  interface NuxtMultiAppRegistry {",
    // Self-valued properties make TypeScript print the literal AppId union in diagnostics.
    ...ids.map((id) => `    ${JSON.stringify(id)}: ${JSON.stringify(id)}`),
    "  }",
    "}",
    "export {}",
  ].join("\n")
}

/** Configure a Nitro output as an importable handler owned by the common server. */
export function applyHandlerOutput(nitro: NitroConfig, id: string) {
  const preset = nitro.preset ?? process.env.NITRO_PRESET ?? process.env.SERVER_PRESET
  if (preset === "node-cluster") {
    throw new Error(
      `nuxt-multi-app: ${id} uses node-cluster, which conflicts with the single-process contract`,
    )
  }
  if (preset && !["node", "node-listener", "node-server"].includes(preset)) {
    throw new Error(`nuxt-multi-app: ${id} uses unsupported Nitro preset ${preset}`)
  }
  nitro.preset = "node"
  nitro.serveStatic = true
}

function assertIsolatedOutput(nitro: NitroConfig, id: string) {
  if (nitro.externals?.trace === false) {
    throw new Error(
      `nuxt-multi-app: ${id} sets nitro.externals.trace=false, which defeats dependency isolation`,
    )
  }
}
