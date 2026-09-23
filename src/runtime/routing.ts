import type { IncomingMessage } from "node:http"

import type { AppId } from "./types"

/** Choose an application, continue with static routing, or force an unmatched response. */
export type MultiAppResolver = (
  host: string,
  request: IncomingMessage,
) => AppId | false | undefined | Promise<AppId | false | undefined>

/** A project module factory that initializes one resolver before requests are accepted. */
export type MultiAppResolverFactory = () => MultiAppResolver | Promise<MultiAppResolver>

/** Diagnostic label of the resolver module in one routing rule. */
export function resolverLabel(index: number) {
  return `resolver in routing rule ${index + 1}`
}

/** Host and path guards that must all match before a routing rule applies. */
export interface RoutingGuards {
  /** Exact hosts or leading-wildcard host patterns, matched with OR semantics. */
  hosts?: string[]
  /** Absolute path prefixes, matched with OR semantics at segment boundaries. */
  paths?: string[]
}

/** A validated routing rule whose resolver has the representation `R` of one pipeline stage. */
export type RoutingRule<R> = RoutingGuards & ({ app: string } | { resolver: R })

/** One executable routing rule after project resolver factories have initialized. */
export type RuntimeRoutingRule = RoutingRule<MultiAppResolver>

/** Replace every resolver through `map`, keeping application rules and all guards unchanged. */
export async function mapResolvers<From, To>(
  rules: RoutingRule<From>[],
  map: (resolver: From, index: number) => Promise<To>,
): Promise<RoutingRule<To>[]> {
  const mapped: RoutingRule<To>[] = []
  // Resolvers are bundled and initialized one at a time, in configuration order.
  for (const [index, rule] of rules.entries()) {
    if ("app" in rule) {
      mapped.push(rule)
      continue
    }
    const { resolver, ...guards } = rule
    mapped.push({ ...guards, resolver: await map(resolver, index) })
  }
  return mapped
}

/** Return the raw pathname without decoding or normalizing request segments. */
export function requestPath(request: IncomingMessage) {
  const target = request.url ?? "/"
  const query = target.indexOf("?")
  return query === -1 ? target : target.slice(0, query)
}

/** Normalize a Host header for both custom resolution and declarative host matching. */
export function normalizeHost(header: string | undefined) {
  return (header ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
}

/** Match one host against exact and leading-wildcard alternatives. */
function matchesHost(patterns: string[], host: string) {
  return patterns.some((pattern) => {
    if (!pattern.startsWith("*.")) return host === pattern
    // `*.example.com` needs at least one label before the suffix, so it excludes `example.com`.
    const suffix = pattern.slice(1)
    return host.endsWith(suffix) && host.length > suffix.length
  })
}

/** Match the exact path or a descendant without decoding or normalizing either value. */
function matchesPath(prefixes: string[], path: string) {
  return prefixes.some(
    (prefix) => prefix === "/" || path === prefix || path.startsWith(`${prefix}/`),
  )
}

/** Select an application by running the configured rules once in list order. */
export async function selectApplication<App extends { id: string }>(
  apps: App[],
  routing: RuntimeRoutingRule[],
  request: IncomingMessage,
): Promise<App | undefined> {
  const host = normalizeHost(request.headers.host)
  const path = requestPath(request)
  for (const rule of routing) {
    // Alternatives within one guard are OR; distinct guard fields must all match.
    if (rule.hosts && !matchesHost(rule.hosts, host)) continue
    if (rule.paths && !matchesPath(rule.paths, path)) continue
    if ("app" in rule) return apps.find((app) => app.id === rule.app)

    const id = await rule.resolver(host, request)
    if (id === false) return undefined
    if (id === undefined) continue
    const app = apps.find((candidate) => candidate.id === id)
    if (!app) throw new Error(`resolver returned unknown application ${id}`)
    return app
  }
  return undefined
}
