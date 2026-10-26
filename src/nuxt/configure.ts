import { addTypeTemplate, createResolver } from "@nuxt/kit"
import type {} from "@nuxt/nitro-server"
import type { NitroConfig } from "nitropack/types"
import type { Nuxt } from "nuxt/schema"

import type { NormalizedAppOptions } from "../options"
import { SETTINGS_MODULE, type NitroPluginSettings } from "../runtime/contract"
import type { GatewayAddress } from "../runtime/dispatch"
import { assertSupportedNuxt } from "./compat"

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

  // Nitro creates its prerender instance from this configuration rather than from the options of
  // the main instance, so both bundles receive the settings module and inlined runtime.
  nuxt.hook("nitro:config", (config) => {
    const pluginSettings: NitroPluginSettings = {
      appId: app.id,
      ids: settings.ids,
      gateway: settings.gateway ?? null,
      token: settings.token ?? "",
    }
    config.virtual = {
      ...config.virtual,
      [SETTINGS_MODULE]: `export default ${JSON.stringify(pluginSettings)}`,
    }
    config.externals ??= {}
    config.externals.inline ??= []
    // Only this module depends on `crossws`, so inline the adapter instead of leaving a bare
    // external for Nitro to resolve from the application.
    config.externals.inline.push(runtimeDir, /[/\\]crossws[/\\]/)
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

function assertIsolatedOutput(nitro: NitroConfig, id: string) {
  if (nitro.externals?.trace === false) {
    throw new Error(
      `nuxt-multi-app: ${id} sets nitro.externals.trace=false, which defeats dependency isolation`,
    )
  }
}
