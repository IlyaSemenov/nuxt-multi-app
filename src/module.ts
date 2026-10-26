import { defineNuxtModule } from "nuxt/kit"
import type { NuxtModule } from "nuxt/schema"

import type { ModuleOptions } from "./options"
import { MODULE_DEFAULTS } from "./options"
import type { MultiAppFallbackFactory } from "./runtime/fallback"
import type { MultiAppResolverFactory } from "./runtime/routing"
import { setupModule } from "./setup"

export type {
  AppOptions,
  AppOverrides,
  ModuleOptions,
  MultiAppRoutingRule,
  RootOptions,
} from "./options"
export type { MultiAppResolver, MultiAppResolverFactory } from "./runtime/routing"
export type {
  MultiAppFallbackReason,
  MultiAppFallback,
  MultiAppFallbackFactory,
} from "./runtime/fallback"
export type {
  AppId,
  NuxtMultiAppCreateFetch,
  NuxtMultiAppCreateFetchOptions,
  NuxtMultiAppDispatch,
  NuxtMultiAppDispatchOptions,
  NuxtMultiAppFetch,
  NuxtMultiAppRequestContext,
} from "./runtime/types"

/** Define a project routing factory with contextual typing. */
export function defineMultiAppResolver(factory: MultiAppResolverFactory): MultiAppResolverFactory {
  return factory
}

/** Define a project fallback factory with contextual typing. */
export function defineMultiAppFallback(factory: MultiAppFallbackFactory): MultiAppFallbackFactory {
  return factory
}

// The annotation makes the published declaration refer to `nuxt/schema`, which resolves through the
// application's Nuxt, instead of `@nuxt/schema`, which this package does not depend on.
/** Nuxt module that composes independently configured applications behind one listener. */
const multiAppModule: NuxtModule<ModuleOptions, ModuleOptions, false> =
  defineNuxtModule<ModuleOptions>({
    meta: {
      name: "nuxt-multi-app",
      configKey: "multiApp",
      compatibility: { nuxt: "~4.5.2 || ~4.6.1" },
    },
    defaults: MODULE_DEFAULTS,
    setup: setupModule,
  })

export default multiAppModule
