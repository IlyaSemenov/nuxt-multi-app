import type { Buffer } from "node:buffer"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"

import type { RoutingRule } from "./routing"
import type { NuxtMultiAppDispatch } from "./types"

/** Node `upgrade` listener signature shared by Nitro's WebSocket adapter and the production entry. */
export type UpgradeHandler = (request: IncomingMessage, socket: Duplex, head: Buffer) => unknown

/** Request event as seen by the Nitro `request` hook. */
export interface NitroEvent {
  context: Record<string, unknown>
  node: {
    req: Pick<IncomingMessage, "headers" | "once">
    res: NodeJS.EventEmitter & { writableEnded?: boolean }
  }
}

/**
 * The parts of a Nitro application the runtime relies on.
 * Declared structurally because every application bundle carries its own copy of this code.
 */
export interface NitroRuntime {
  hooks: {
    hook(name: string, handler: (event: NitroEvent) => unknown): unknown
    callHook(name: string, ...args: unknown[]): Promise<unknown>
  }
  h3App?: { websocket?: unknown }
  localFetch(input: string, init?: Record<string, unknown>): Promise<Response>
}

/** Process-wide registry the production entry installs before importing any application bundle. */
export interface ProductionRuntime {
  register(appId: string, nitro: NitroRuntime, upgrade?: UpgradeHandler): void
  dispatch: NuxtMultiAppDispatch
}

/** Composition that `nuxt build` writes for the production entry; module URLs are relative to it. */
export interface ProductionManifest {
  apps: { id: string; entry: string }[]
  routing: RoutingRule<string>[]
  stateHandler: string | null
  readinessPath?: string
  shutdownTimeout: number
  debug: boolean
}

/** Global key under which the production entry publishes its registry to the Nitro plugin. */
export const runtimeSymbol = Symbol.for("nuxt-multi-app.runtime")
