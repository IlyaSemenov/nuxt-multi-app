import { describe, expect, it } from "bun:test"

import { createDevDispatch, createFetchFactory } from "./dispatch"
import { internalPath } from "./request"
import type { NuxtMultiAppDispatch } from "./types"

describe("dispatch addressing", () => {
  it("uses only path and query from an absolute Request URL", () => {
    expect(internalPath(new Request("https://public.example/api/rpc?batch=1"))).toBe(
      "/api/rpc?batch=1",
    )
  })

  it("rejects unknown registry IDs before transport", async () => {
    const dispatch = createDevDispatch(
      "root",
      ["root", "web"],
      { localFetch: async () => new Response("local") },
      { socketPath: "/unused" },
      "token",
    )
    await expect(dispatch("unknown", new Request("http://internal/marker"))).rejects.toThrow(
      "is not registered",
    )
  })

  it("calls the current Nitro application directly", async () => {
    const calls: string[] = []
    const dispatch = createDevDispatch(
      "web",
      ["web"],
      {
        async localFetch(path) {
          calls.push(path)
          return new Response("web")
        },
      },
      { socketPath: "/unused" },
      "token",
    )
    expect(await (await dispatch("web", new Request("http://internal/marker?q=1"))).text()).toBe(
      "web",
    )
    expect(calls).toEqual(["/marker?q=1"])
  })
})

describe("bound fetch", () => {
  it("dispatches to the bound application and keeps the incoming event signal", async () => {
    const calls: { targetId: string; path: string; aborted: boolean }[] = []
    const dispatch: NuxtMultiAppDispatch = async (targetId, request, options) => {
      calls.push({
        targetId,
        path: internalPath(request),
        aborted: options?.signal?.aborted ?? false,
      })
      return new Response("ok")
    }
    const controller = new AbortController()
    controller.abort()

    const fetch = createFetchFactory(dispatch, controller.signal)("tenant")
    const response = await fetch("http://internal/api/rpc/posts?batch=1", { method: "POST" })

    expect(await response.text()).toBe("ok")
    expect(calls).toEqual([{ targetId: "tenant", path: "/api/rpc/posts?batch=1", aborted: true }])
  })

  it("propagates the signal from a Request input", async () => {
    let signal: AbortSignal | undefined
    const dispatch: NuxtMultiAppDispatch = async (_targetId, _request, options) => {
      signal = options?.signal
      return new Response("ok")
    }
    const inputController = new AbortController()
    const fetch = createFetchFactory(dispatch, new AbortController().signal)("tenant")

    await fetch(new Request("http://internal/api/rpc/posts", { signal: inputController.signal }))
    inputController.abort()

    expect(signal?.aborted).toBe(true)
  })
})
