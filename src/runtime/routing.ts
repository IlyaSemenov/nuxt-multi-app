import type { IncomingMessage } from "node:http"

import type { MultiAppResolver } from "../options"

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

/** Select an application once, before the request body is consumed: resolver, hosts, then fallback. */
export async function selectApplication<App extends { id: string; hosts: string[] }>(
  apps: App[],
  fallback: string | false,
  resolver: MultiAppResolver | undefined,
  request: IncomingMessage,
): Promise<App | undefined> {
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
