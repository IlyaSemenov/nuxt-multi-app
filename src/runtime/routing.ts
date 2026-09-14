import type { IncomingMessage } from "node:http"

import type { MultiAppResolver } from "../options"
import { requestPath } from "./request"

/** One executable routing rule after project resolver factories have initialized. */
export type RuntimeRoutingRule =
  | { app: string; hosts?: string[]; paths?: string[] }
  | { resolver: MultiAppResolver; hosts?: string[]; paths?: string[] }

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
