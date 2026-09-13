import { defineNuxtModule } from "@nuxt/kit"

import type { ModuleOptions, MultiAppResolverFactory, MultiAppStateHandlerFactory } from "./options"
import { MODULE_DEFAULTS } from "./options"
import { setupModule } from "./setup"

export type {
  AppOptions,
  AppOverrides,
  ModuleOptions,
  MultiAppResolver,
  MultiAppResolverFactory,
  MultiAppStartupContext,
  MultiAppState,
  MultiAppStateHandler,
  MultiAppStateHandlerFactory,
  RootOptions,
} from "./options"
export type {
  NuxtMultiAppCreateFetch,
  NuxtMultiAppDispatch,
  NuxtMultiAppDispatchOptions,
  NuxtMultiAppFetch,
  NuxtMultiAppRequestContext,
} from "./runtime/types"

/** Define a project routing factory with contextual typing. */
export function defineMultiAppResolver(factory: MultiAppResolverFactory): MultiAppResolverFactory {
  return factory
}

/** Define a project state-handler factory with contextual typing. */
export function defineMultiAppStateHandler(
  factory: MultiAppStateHandlerFactory,
): MultiAppStateHandlerFactory {
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
