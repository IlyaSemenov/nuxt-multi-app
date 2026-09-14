import type { IncomingMessage } from "node:http"

import type { MultiAppResolver } from "../options"
import { requestPath } from "./request"

/** Normalize a Host header for both custom resolution and declarative host matching. */
export function normalizeHost(header: string | undefined) {
  return (header ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
}

/** Select the first application whose exact or leading-wildcard host pattern matches. */
function selectHost<App extends { hosts: string[] }>(apps: App[], host: string) {
  return apps.find((app) =>
    app.hosts.some((pattern) => {
      if (!pattern.startsWith("*.")) return host === pattern
      // `*.example.com` needs at least one label before the suffix, so it excludes `example.com`.
      const suffix = pattern.slice(1)
      return host.endsWith(suffix) && host.length > suffix.length
    }),
  )
}

/** Select the application with the longest matching path prefix. */
function selectPath<App extends { paths: string[] }>(apps: App[], path: string) {
  let match: App | undefined
  let matchLength = -1
  for (const app of apps) {
    for (const prefix of app.paths) {
      // A prefix owns its exact path and descendants, while `/` owns every absolute path.
      if (
        prefix.length > matchLength &&
        (prefix === "/" || path === prefix || path.startsWith(`${prefix}/`))
      ) {
        match = app
        matchLength = prefix.length
      }
    }
  }
  return match
}

/** Select an application once: path prefixes, resolver, hosts, then fallback. */
export async function selectApplication<
  App extends { id: string; paths: string[]; hosts: string[] },
>(
  apps: App[],
  fallback: string | false,
  resolver: MultiAppResolver | undefined,
  request: IncomingMessage,
): Promise<App | undefined> {
  const pathMatch = selectPath(apps, requestPath(request))
  if (pathMatch) return pathMatch
  const host = normalizeHost(request.headers.host)
  if (resolver) {
    const id = await resolver(host, request)
    if (id === false) return undefined
    if (id !== undefined) {
      const app = apps.find((candidate) => candidate.id === id)
      if (!app) throw new Error(`resolver returned unknown application ${id}`)
      return app
    }
  }
  const hostMatch = selectHost(apps, host)
  if (hostMatch) return hostMatch
  return fallback === false ? undefined : apps.find((app) => app.id === fallback)
}
