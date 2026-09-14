import {
  defineMultiAppResolver,
  defineMultiAppStateHandler,
  type AppId,
  type AppOverrides,
  type ModuleOptions,
  type MultiAppResolver,
  type MultiAppState,
} from "nuxt-multi-app"
import type { NuxtMultiAppRequestContext } from "nuxt-multi-app/runtime"

declare module "nuxt-multi-app/runtime" {
  interface NuxtMultiAppRegistry {
    root: unknown
    web: unknown
  }
}

const options = {
  root: { id: "root", paths: ["/internal"], hosts: ["example.test"] },
  apps: [{ id: "web", rootDir: "../web", paths: ["/api"], hosts: ["*.tenant.test"] }],
  fallback: "web",
  resolver: "./resolver.ts",
  readinessPath: "/ready",
} satisfies ModuleOptions

declare const context: NuxtMultiAppRequestContext
const appId: AppId = "root"
const response: Promise<Response> = context.dispatch(
  "web",
  new Request("http://internal/api/rpc"),
  { signal: context.signal },
)
// @ts-expect-error generated application IDs reject misspelled dispatch targets.
context.dispatch("website", new Request("http://internal/api/rpc"))

// @ts-expect-error generated application IDs reject unknown resolver results.
const invalidResolver: MultiAppResolver = () => "website"

void appId
void response
void invalidResolver
void (undefined as unknown as MultiAppState)

const overrides: AppOverrides = { ssr: false }
const createResolver = defineMultiAppResolver(({ appIds }) => {
  if (!appIds.has("root")) throw new Error("root is not mounted")
  return (host) => (host === "example.test" ? "root" : undefined)
})
const createStateHandler = defineMultiAppStateHandler(({ appIds }) => {
  if (!appIds.has("web")) throw new Error("web is not mounted")
  return (_state, _request, response) => {
    response.end()
  }
})

void overrides
void createResolver
void createStateHandler
