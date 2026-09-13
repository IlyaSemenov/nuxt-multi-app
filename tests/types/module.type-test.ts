import {
  defineMultiAppResolver,
  defineMultiAppStateHandler,
  type AppOverrides,
  type ModuleOptions,
  type MultiAppState,
} from "nuxt-multi-app"
import type { NuxtMultiAppRequestContext } from "nuxt-multi-app/runtime"

const options = {
  root: { id: "root", hosts: ["example.test"] },
  apps: [{ id: "web", rootDir: "../web", hosts: ["*.tenant.test"] }],
  fallback: "web",
  resolver: "./resolver.ts",
  readinessPath: "/ready",
} satisfies ModuleOptions

declare const context: NuxtMultiAppRequestContext
const response: Promise<Response> = context.dispatch(
  options.apps[0]!.id,
  new Request("http://internal/api/rpc"),
  { signal: context.signal },
)

void response
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
