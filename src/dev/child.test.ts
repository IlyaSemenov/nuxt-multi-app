import { describe, expect, it } from "bun:test"
import { createServer, IncomingMessage, ServerResponse } from "node:http"
import { Socket } from "node:net"

import type { Nuxt } from "nuxt/schema"

import { defaultFallback, type MultiAppFallbackReason } from "../runtime/fallback"
import { createChild } from "./child"

describe("child shutdown before loading", () => {
  for (const disconnected of [false, true]) {
    it(`releases an awaiting request${disconnected ? " after its caller disconnects" : " with the closing fallback"}`, async () => {
      const reasons: MultiAppFallbackReason[] = []
      const child = createChild(
        { id: "web", rootDir: "/unused", buildDir: "/unused/.nuxt", overrides: {}, isRoot: false },
        {
          root: {} as Nuxt,
          ids: ["root", "web"],
          gateway: { address: { socketPath: "/unused" }, token: "unused", invalidate() {} },
          fallback(reason, request, response) {
            reasons.push(reason)
            return defaultFallback(reason, request, response)
          },
          debug: false,
        },
      )
      const request = new IncomingMessage(new Socket())
      const response = new ServerResponse(request)
      let answered = false
      const pending = child.handle(request, response).then(() => {
        answered = true
      })
      await Promise.resolve()
      expect(answered).toBe(false)
      if (disconnected) response.destroy()

      await child.close()
      await pending
      expect(answered).toBe(true)
      expect(reasons).toEqual(disconnected ? [] : [{ type: "closing", appId: "web" }])
      if (!disconnected) {
        expect(response.statusCode).toBe(503)
        expect(response.getHeader("retry-after")).toBe("1")
        expect(response.writableEnded).toBe(true)
      }
      await child.start(createServer())
      expect(child.state.type).toBe("closing")
      request.destroy()
    })
  }
})
