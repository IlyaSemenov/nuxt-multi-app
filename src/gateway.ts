import { randomBytes } from "node:crypto"
import { unlink } from "node:fs/promises"
import type { RequestListener, Server, ServerResponse } from "node:http"
import { createServer } from "node:http"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"

import { logger } from "./logger"

export type GatewayAddress = { socketPath: string } | { host: string; port: number }

export interface GatewayTarget {
  id: string
  handle: RequestListener
}

interface GatewayOptions {
  platform?: NodeJS.Platform
  socketPath?: string
}

/** Create a private HTTP gateway used only between Nitro development workers. */
export function createGateway(
  getTarget: (id: string) => GatewayTarget | undefined,
  options: GatewayOptions = {},
) {
  const token = randomBytes(24).toString("base64url")
  const socketPath =
    options.socketPath ??
    join(tmpdir(), `nuxt-multi-app-${process.pid}-${randomBytes(5).toString("hex")}.sock`)
  const active = new Map<string, Set<ServerResponse>>()
  const server = createServer((request, response) => {
    if (request.headers["x-nuxt-multi-app-token"] !== token) {
      response.statusCode = 403
      response.end("Forbidden")
      return
    }
    const id = request.headers["x-nuxt-multi-app-target"]
    // Gateway credentials and addressing are transport metadata, never application headers.
    delete request.headers["x-nuxt-multi-app-token"]
    delete request.headers["x-nuxt-multi-app-target"]
    const target = typeof id === "string" ? getTarget(id) : undefined
    if (!target) {
      response.statusCode = 500
      response.end("Unknown nuxt-multi-app target")
      return
    }
    const responses = active.get(target.id) ?? new Set<ServerResponse>()
    active.set(target.id, responses)
    responses.add(response)
    const release = () => {
      responses.delete(response)
      if (!responses.size) active.delete(target.id)
    }
    response.once("finish", release)
    response.once("close", release)
    Promise.resolve(target.handle(request, response)).catch((error) => {
      logger.withTag(target.id).error(error)
      if (response.headersSent) response.destroy(error as Error)
      else {
        response.statusCode = 500
        response.end("Application dispatch failed")
      }
    })
  })

  let address: GatewayAddress | undefined

  return {
    token,
    get address() {
      if (!address) throw new Error("nuxt-multi-app: dispatch gateway is not listening")
      return address
    },
    /** End calls owned by a replaced Nitro worker without replaying them on its successor. */
    invalidate(id: string) {
      for (const response of active.get(id) ?? []) response.destroy()
    },
    async listen() {
      if (address) return address
      if ((options.platform ?? process.platform) !== "win32") {
        try {
          await listen(server, socketPath)
          address = { socketPath }
          return address
        } catch (error) {
          logger.warn("Unix dispatch gateway failed; using loopback TCP", error)
        }
      }
      await listen(server, 0, "127.0.0.1")
      const bound = server.address()
      if (!bound || typeof bound === "string") {
        throw new Error("nuxt-multi-app: dispatch gateway did not receive a TCP port")
      }
      address = { host: "127.0.0.1", port: bound.port }
      return address
    },
    async close(timeout: number) {
      if (!address) return
      const closed = new Promise<void>((resolve) => server.close(() => resolve()))
      server.closeIdleConnections()
      const timer = setTimeout(() => server.closeAllConnections(), timeout)
      timer.unref()
      await closed
      clearTimeout(timer)
      if ("socketPath" in address) await unlink(address.socketPath).catch(() => undefined)
      address = undefined
    },
  }
}

function listen(server: Server, ...args: [string] | [number, string]) {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening)
      reject(error)
    }
    const onListening = () => {
      server.off("error", onError)
      resolve()
    }
    server.once("error", onError)
    server.once("listening", onListening)
    if (args.length === 1) server.listen(args[0])
    else server.listen(args[0], args[1])
  })
}
