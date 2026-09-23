import { request as nodeRequest } from "node:http"
import { Readable } from "node:stream"

import type { NitroRuntime } from "./contract"
import type {
  NuxtMultiAppCreateFetch,
  NuxtMultiAppDispatch,
  NuxtMultiAppDispatchOptions,
} from "./types"

/** Address of the private development gateway, as embedded in each Nitro development bundle. */
export type GatewayAddress = { socketPath: string } | { host: string; port: number }

type IncomingHeaders = Readonly<Record<string, string | string[] | undefined>>

/** Create a dispatcher for one Nitro development worker. */
export function createDevDispatch(
  appId: string,
  ids: string[],
  nitro: Pick<NitroRuntime, "localFetch">,
  gateway: GatewayAddress,
  token: string,
): NuxtMultiAppDispatch {
  return async (targetId, request, options) => {
    assertDispatchTarget(ids, targetId)
    return targetId === appId
      ? localFetch(nitro, request, options)
      : gatewayFetch(gateway, token, targetId, request, options)
  }
}

/** Build the request-context `createFetch`, which binds `fetch` to one target application. */
export function createFetchFactory(
  dispatch: NuxtMultiAppDispatch,
  requestSignal: AbortSignal,
  incomingHeaders: IncomingHeaders = {},
): NuxtMultiAppCreateFetch {
  return (targetId, options) => (input, init) => {
    const request = inheritRequestHeaders(
      new Request(input, init),
      incomingHeaders,
      options?.inheritRequestHeaders,
    )
    return dispatch(targetId, request, {
      // The normalized request follows either `input.signal` or an overriding `init.signal`.
      signal: mergeSignals(requestSignal, options?.signal, request.signal),
    })
  }
}

/** Fill absent request headers from the incoming HTTP request without changing Fetch precedence. */
function inheritRequestHeaders(
  request: Request,
  incoming: IncomingHeaders,
  names: readonly string[] | undefined,
) {
  if (!names?.length) return request
  const headers = new Headers(request.headers)
  for (const name of names) {
    // Presence, including an explicit empty value, prevents inheritance.
    if (headers.has(name)) continue
    const value = incoming[name.toLowerCase()]
    if (value === undefined) continue
    headers.set(
      name,
      Array.isArray(value) ? value.join(name.toLowerCase() === "cookie" ? "; " : ", ") : value,
    )
  }
  return new Request(request, { headers })
}

function mergeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const present = signals.filter((signal) => signal !== undefined)
  return present.length === 1 ? present[0]! : AbortSignal.any(present)
}

/** Call a Nitro instance with only the path and query from a Web Request. */
export function localFetch(
  nitro: Pick<NitroRuntime, "localFetch">,
  request: Request,
  options: NuxtMultiAppDispatchOptions = {},
) {
  return nitro.localFetch(internalPath(request), {
    method: request.method,
    headers: request.headers,
    ...(request.body && request.method !== "GET" && request.method !== "HEAD"
      ? { body: request.body, duplex: "half" }
      : {}),
    // Nitro copies `_platform` onto `event.context`, where the plugin reads the caller's signal.
    context: { _platform: { nuxtMultiAppDispatchSignal: options.signal } },
  })
}

/** Reject a dispatch target that is not a registry ID of this composition. */
export function assertDispatchTarget(ids: string[], targetId: string) {
  if (!ids.includes(targetId)) {
    throw new Error(`nuxt-multi-app: dispatch target ${targetId} is not registered`)
  }
}

/** Forward a dispatch through the private development gateway with streaming backpressure. */
export function gatewayFetch(
  gateway: GatewayAddress,
  token: string,
  targetId: string,
  request: Request,
  options: NuxtMultiAppDispatchOptions = {},
): Promise<Response> {
  const headers = new Headers(request.headers)
  headers.set("x-nuxt-multi-app-token", token)
  headers.set("x-nuxt-multi-app-target", targetId)
  const connection =
    "socketPath" in gateway
      ? { socketPath: gateway.socketPath }
      : { host: gateway.host, port: gateway.port }

  return new Promise((resolve, reject) => {
    const outgoing = nodeRequest(
      {
        ...connection,
        path: internalPath(request),
        method: request.method,
        headers: Object.fromEntries(headers),
        signal: options.signal,
        agent: false,
      },
      (incoming) => {
        const responseHeaders = new Headers()
        for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
          responseHeaders.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!)
        }
        resolve(
          new Response(
            request.method === "HEAD" || [204, 205, 304].includes(incoming.statusCode ?? 200)
              ? null
              : (Readable.toWeb(incoming) as unknown as ReadableStream),
            {
              status: incoming.statusCode,
              statusText: incoming.statusMessage,
              headers: responseHeaders,
            },
          ),
        )
      },
    )
    outgoing.on("error", reject)
    if (request.body && request.method !== "GET" && request.method !== "HEAD") {
      Readable.fromWeb(request.body as never)
        .on("error", (error) => outgoing.destroy(error))
        .pipe(outgoing)
    } else {
      outgoing.end()
    }
  })
}

/**
 * Convert an absolute Web Request URL to the only address accepted by internal dispatch.
 */
export function internalPath(request: Request) {
  const url = new URL(request.url)
  if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError(
      "nuxt-multi-app: dispatch requires an HTTP Request without credentials or hash",
    )
  }
  // Discard the origin so an application base URL can never turn dispatch into public TCP traffic.
  return `${url.pathname}${url.search}`
}
