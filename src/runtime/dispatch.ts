import { request as nodeRequest } from "node:http"
import { Readable } from "node:stream"

import type { GatewayAddress } from "../gateway"
import { internalPath } from "./request"
import type {
  NuxtMultiAppCreateFetch,
  NuxtMultiAppDispatch,
  NuxtMultiAppDispatchOptions,
} from "./types"

interface NitroRuntime {
  localFetch(input: string, init?: Record<string, unknown>): Promise<Response>
}

/** Create a dispatcher for one Nitro development worker. */
export function createDevDispatch(
  appId: string,
  ids: string[],
  nitro: NitroRuntime,
  gateway: GatewayAddress,
  token: string,
): NuxtMultiAppDispatch {
  return async (targetId, request, options) => {
    assertTarget(ids, targetId)
    return targetId === appId
      ? localFetch(nitro, request, options)
      : gatewayFetch(gateway, token, targetId, request, options)
  }
}

/** Build the request-context `createFetch`, which binds `fetch` to one target application. */
export function createFetchFactory(
  dispatch: NuxtMultiAppDispatch,
  requestSignal: AbortSignal,
): NuxtMultiAppCreateFetch {
  return (targetId, options) => (input, init) =>
    dispatch(targetId, new Request(input, init), {
      signal: mergeSignals(requestSignal, options?.signal, init?.signal ?? undefined),
    })
}

function mergeSignals(...signals: (AbortSignal | undefined)[]): AbortSignal {
  const present = signals.filter((signal) => signal !== undefined)
  return present.length === 1 ? present[0]! : AbortSignal.any(present)
}

/** Call a Nitro instance with only the path and query from a Web Request. */
export function localFetch(
  nitro: NitroRuntime,
  request: Request,
  options: NuxtMultiAppDispatchOptions = {},
) {
  const path = internalPath(request)
  return nitro.localFetch(path, {
    method: request.method,
    headers: request.headers,
    ...(request.body && request.method !== "GET" && request.method !== "HEAD"
      ? { body: request.body, duplex: "half" }
      : {}),
    context: { _platform: { nuxtMultiAppDispatchSignal: options.signal } },
  })
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

function assertTarget(ids: string[], targetId: string) {
  if (!ids.includes(targetId)) {
    throw new Error(`nuxt-multi-app: dispatch target ${targetId} is not registered`)
  }
}
