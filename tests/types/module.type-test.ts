import {
  defineMultiAppResolver,
  defineMultiAppFallback,
  type AppId,
  type AppOverrides,
  type ModuleOptions,
  type MultiAppResolver,
  type MultiAppFallbackReason,
  type NuxtMultiAppCreateFetchOptions,
} from "nuxt-multi-app"
import type { NuxtMultiAppRequestContext } from "nuxt-multi-app/runtime"

declare module "nuxt-multi-app/runtime" {
  interface NuxtMultiAppRegistry {
    root: "root"
    web: "web"
  }
}

const options = {
  root: { id: "root" },
  apps: [{ id: "web", rootDir: "../web" }],
  routing: [
    { paths: ["/api"], app: "web" },
    { hosts: ["*.tenant.test"], resolver: "./resolver.ts" },
    { app: "root" },
  ],
  readinessPath: "/ready",
} satisfies ModuleOptions
void options

const invalidRule = {
  // @ts-expect-error a routing rule cannot select an app and invoke a resolver.
  routing: [{ app: "root", resolver: "./resolver.ts" }],
} satisfies ModuleOptions

declare const context: NuxtMultiAppRequestContext
const appId: AppId = "root"
const response: Promise<Response> = context.dispatch(
  "web",
  new Request("http://internal/api/rpc"),
  { signal: context.signal },
)
const fetchOptions: NuxtMultiAppCreateFetchOptions = { inheritRequestHeaders: ["cookie"] }
const boundFetch = context.createFetch("web", fetchOptions)
// @ts-expect-error generated application IDs reject misspelled dispatch targets.
context.dispatch("website", new Request("http://internal/api/rpc"))

// @ts-expect-error generated application IDs reject unknown resolver results.
const invalidResolver: MultiAppResolver = () => "website"

void appId
void response
void boundFetch
void invalidResolver
void invalidRule
void (undefined as unknown as MultiAppFallbackReason)

const overrides: AppOverrides = { ssr: false }
const createResolver = defineMultiAppResolver(
  () => (host) => (host === "example.test" ? "root" : undefined),
)
const createFallback = defineMultiAppFallback(() => (_reason, _request, response) => {
  response.end()
})

void overrides
void createResolver
void createFallback
