/**
 * Normalize a Host header for both custom resolution and declarative host matching.
 *
 * @param {string | undefined} header
 */
export function normalizeHost(header) {
  return (header ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
}

/**
 * Select the first application whose exact or leading-wildcard host pattern matches.
 *
 * @template {{ hosts: string[] }} App
 * @param {App[]} apps
 * @param {string} host
 * @returns {App | undefined}
 */
function selectHost(apps, host) {
  return apps.find((app) =>
    app.hosts.some((pattern) =>
      pattern.startsWith("*.")
        ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1
        : host === pattern,
    ),
  )
}

/**
 * Select an application once, before the request body is consumed.
 *
 * @template {{ id: string, hosts: string[] }} App
 * @param {App[]} apps
 * @param {string | false} fallback
 * @param {((host: string, request: import("node:http").IncomingMessage) => string | false | undefined | Promise<string | false | undefined>) | undefined} resolver
 * @param {import("node:http").IncomingMessage} request
 * @returns {Promise<App | undefined>}
 */
export async function selectApplication(apps, fallback, resolver, request) {
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
