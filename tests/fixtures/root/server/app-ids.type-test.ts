import type { MultiAppResolver } from "nuxt-multi-app"
import type { NuxtMultiAppRequestContext } from "nuxt-multi-app/runtime"

declare const context: NuxtMultiAppRequestContext

context.dispatch("web", new Request("http://internal"))

// @ts-expect-error prepare:types restricts dispatch targets to configured application IDs.
context.dispatch("website", new Request("http://internal"))

// @ts-expect-error prepare:types restricts resolver results to configured application IDs.
const invalidResolver: MultiAppResolver = () => "website"

void invalidResolver
