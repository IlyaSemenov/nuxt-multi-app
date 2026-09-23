import { defineNuxtModule } from "@nuxt/kit"

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

/** Nuxt module that composes independently configured applications behind one listener. */
export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: "nuxt-multi-app",
    configKey: "multiApp",
    compatibility: { nuxt: "~4.5.2" },
  },
  defaults: MODULE_DEFAULTS,
  setup: setupModule,
})
