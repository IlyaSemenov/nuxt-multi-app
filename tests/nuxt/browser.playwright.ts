import assert from "node:assert/strict"
import { access, readFile, writeFile } from "node:fs/promises"
import http from "node:http"
import { join } from "node:path"

import { type APIRequestContext, expect, type Page, test } from "@playwright/test"

import { readViteSnapshots } from "./snapshots"

const workspace = process.env.NUXT_MULTI_APP_TEST_WORKSPACE!
const port = process.env.NUXT_MULTI_APP_TEST_PORT!
const mode = process.env.NUXT_MULTI_APP_TEST_MODE as "development" | "production"
const origins = [`http://landing.localhost:${port}`, `http://foo.tenant.localhost:${port}`]
const apps = ["root", "web"] as const
const appIds = ["root", "web"] as const
const markers = ["ROOT", "WEB"] as const

test("isolates mounted applications and exercises their browser runtime", async ({ browser }) => {
  const context = await browser.newContext()
  const pages = await Promise.all(origins.map(() => context.newPage()))
  const requests = [[], []] as string[][]
  const hmr = [[], []] as string[][]
  const socketEvents = [
    { opened: 0, closed: 0 },
    { opened: 0, closed: 0 },
  ]
  const errors: string[] = []

  try {
    for (const [index, page] of pages.entries()) {
      page.on("pageerror", (error) => errors.push(`${apps[index]}: ${error.message}`))
      page.on("requestfailed", (request) => {
        errors.push(`${apps[index]}: ${request.url()} ${request.failure()?.errorText}`)
      })
      page.on("request", (request) => requests[index]!.push(request.url()))
      page.on("websocket", (socket) => {
        socketEvents[index]!.opened++
        socket.on("close", () => socketEvents[index]!.closed++)
        socket.on("framereceived", (frame) => hmr[index]!.push(String(frame.payload)))
      })
      const response = await page.goto(origins[index]!)
      expect(response?.status()).toBe(200)
      await page.waitForFunction(
        (appId) => document.documentElement.dataset.instance === appId,
        appIds[index],
      )
      await expect(page.getByRole("heading")).toHaveText(`${markers[index]}_HMR_0`)
      await expect(page.locator("#instance")).toContainText(`${markers[index]}_PLUGIN`)
    }

    await expect(pages[1]!.getByText("web-auto-import")).toBeVisible()
    await expect(pages[1]!.getByText("child-component")).toBeVisible()
    await expect(pages[1]!.getByText("ISOLATED_COMPONENT")).toBeVisible()
    await expect(pages[1]!.locator("#instance")).toContainText("ISOLATED_PLUGIN")
    expect(
      await pages[1]!
        .getByText("ISOLATED_COMPONENT")
        .evaluate((element) => getComputedStyle(element).color),
    ).toBe("rgb(123, 45, 67)")
    expect(await pages[0]!.content()).not.toContain("ISOLATED_")
    expect(requests[0]!.some((url) => url.includes("/modules/isolated/"))).toBe(false)
    expect(
      await pages[0]!.evaluate(() =>
        [...document.styleSheets]
          .flatMap((sheet) => {
            try {
              return [...sheet.cssRules].map((rule) => rule.cssText)
            } catch {
              return []
            }
          })
          .join("\n"),
      ),
    ).not.toContain(".isolated-badge")

    const echo = await context.request.post(`${origins[0]}/api/dispatch/echo`, {
      headers: { cookie: "session=root", "content-type": "text/plain" },
      data: "payload",
    })
    expect(echo.status()).toBe(200)
    expect(echo.headers()["x-owner"]).toBe("web")
    expect(
      echo
        .headersArray()
        .filter(({ name }) => name.toLowerCase() === "set-cookie")
        .map(({ value }) => value.split(";")[0]),
    ).toEqual(["owner-a=1", "owner-b=2"])
    expect(await echo.json()).toMatchObject({
      app: "web",
      host: `landing.localhost:${port}`,
      cookie: "session=root",
      body: "payload",
    })

    const inherited = await context.request.post(`${origins[0]}/api/create-fetch`, {
      headers: { cookie: "session=inherited", "content-type": "text/plain" },
      data: "inherited payload",
    })
    expect(await inherited.json()).toMatchObject({
      app: "web",
      host: `landing.localhost:${port}`,
      cookie: "session=inherited",
      body: "inherited payload",
    })

    const cancelledRequest = pages[0]!.waitForEvent("requestfailed", {
      predicate: (request) => request.url() === `${origins[0]}/api/dispatch/slow`,
    })
    await pages[0]!.evaluate(async () => {
      const controller = new AbortController()
      const pending = fetch("/api/dispatch/slow", { signal: controller.signal }).catch(
        () => undefined,
      )
      setTimeout(() => controller.abort(), 100)
      await pending
    })
    const cancelled = await cancelledRequest
    expect(cancelled.failure()?.errorText).toBe("net::ERR_ABORTED")
    expect(errors).toEqual([`root: ${cancelled.url()} net::ERR_ABORTED`])
    // Consume only the failure asserted above; all subsequent browser errors remain unexpected.
    errors.length = 0
    await expect
      .poll(async () =>
        context.request
          .get(`${origins[1]}/api/dispatch/state`)
          .then((response) => response.json())
          .then((state) => state.cancelled),
      )
      .toBe(1)

    if (mode !== "development") {
      const assets = await Promise.all(
        pages.map((page) => page.locator('script[type="module"][src]').first().getAttribute("src")),
      )
      expect(assets[0]).toBeTruthy()
      expect(assets[1]).toBeTruthy()
      expect(assets[0]).not.toBe(assets[1])
      for (const [index, origin] of origins.entries()) {
        const own = await context.request.get(new URL(assets[index]!, origin).href)
        expect(own.status()).toBe(200)
        expect(own.headers()["content-type"]).toMatch(/javascript/)
        const foreign = await context.request.get(new URL(assets[1 - index]!, origin).href)
        expect(foreign.status()).toBe(404)
      }
      expect(socketEvents.every(({ opened }) => opened === 0)).toBe(true)
      await assertStableRuntime(pages, context.request, "0")
      expect(errors).toEqual([])
      return
    }

    await expect
      .poll(() =>
        hmr.every((frames) => frames.some((frame) => frame.includes('"type":"connected"'))),
      )
      .toBe(true)

    for (const page of pages) {
      await page.getByRole("button", { name: "Count 0" }).click()
      await page.evaluate(() => {
        ;(
          globalThis as typeof globalThis & { nuxtMultiAppDocument?: string }
        ).nuxtMultiAppDocument = crypto.randomUUID()
      })
    }
    const documents = await Promise.all(
      pages.map((page) =>
        page.evaluate(
          () =>
            (globalThis as typeof globalThis & { nuxtMultiAppDocument?: string })
              .nuxtMultiAppDocument,
        ),
      ),
    )

    for (const index of [0, 1]) {
      const path = join(workspace, apps[index]!, "app/app.vue")
      const siblingFrames = hmr[1 - index]!.length
      await replace(path, `${markers[index]}_HMR_0`, `${markers[index]}_HMR_1`)
      await expect(pages[index]!.getByRole("heading")).toHaveText(`${markers[index]}_HMR_1`)
      for (const [pageIndex, page] of pages.entries()) {
        await expect(page.getByRole("button", { name: "Count 1" })).toBeVisible()
        expect(
          await page.evaluate(
            () =>
              (globalThis as typeof globalThis & { nuxtMultiAppDocument?: string })
                .nuxtMultiAppDocument,
          ),
        ).toBe(documents[pageIndex])
      }
      expect(hmr[1 - index]!.length).toBe(siblingFrames)
    }

    const overlapStarted = Date.now()
    await Promise.all(
      apps.map((app, index) =>
        writeFile(
          join(workspace, app, "app/plugins/overlap-probe.ts"),
          `export default defineNuxtPlugin(() => { if (import.meta.client) document.documentElement.dataset.overlap = "${markers[index]}" })\n`,
          { flag: "wx" },
        ),
      ),
    )
    await Promise.all(
      pages.map((page, index) =>
        page.waitForFunction(
          (marker) => document.documentElement.dataset.overlap === marker,
          markers[index],
        ),
      ),
    )
    const records = await readContextRecords(overlapStarted)
    expect(records.length).toBeGreaterThanOrEqual(2)
    for (const record of records) {
      expect(record.before).toBe(record.expected)
      expect(record.after).toBe(record.expected)
    }
    expect(
      records.some((left) =>
        records.some(
          (right) =>
            left.expected !== right.expected &&
            Math.max(left.start, right.start) < Math.min(left.end, right.end),
        ),
      ),
    ).toBe(true)

    let snapshots = await readViteSnapshots(workspace)
    const transaction = await context.request
      .post(`${origins[1]}/api/dispatch/transaction`)
      .then((response) => response.json())
    await pages[0]!.evaluate(() => {
      const state = globalThis as typeof globalThis & { pendingDispatch?: Promise<unknown> }
      state.pendingDispatch = fetch("/api/dispatch/slow").catch(() => undefined)
    })
    await replace(join(workspace, "web/server/api/marker.get.ts"), "WEB_SERVER_0", "WEB_SERVER_1")
    await expect
      .poll(async () => {
        const state = await context.request
          .get(`${origins[1]}/api/dispatch/state`)
          .then((response) => response.json())
          .catch(() => undefined)
        return state?.generation
      })
      .not.toBe(transaction.generation)
    const nextState = await context.request
      .get(`${origins[1]}/api/dispatch/state`)
      .then((response) => response.json())
    expect(nextState.transaction).toBeUndefined()
    await pages[0]!.evaluate(
      () =>
        (globalThis as typeof globalThis & { pendingDispatch?: Promise<unknown> }).pendingDispatch,
    )
    await assertSsr(context.request, "1")
    expect(await readViteSnapshots(workspace)).toEqual(snapshots)

    await replace(
      join(workspace, "root/server/api/marker.get.ts"),
      "ROOT_SERVER_0",
      "ROOT_SERVER_1",
    )
    for (const [index, revision] of ["ROOT_SERVER_1", "WEB_SERVER_1"].entries()) {
      await expect
        .poll(async () =>
          context.request
            .get(`${origins[index]}/api/marker`)
            .then((response) => response.json())
            .then((body) => body.revision)
            .catch(() => undefined),
        )
        .toBe(revision)
      const internal = await context.request
        .get(`${origins[index]}/api/internal`)
        .then((response) => response.json())
      expect(internal).toMatchObject({ app: appIds[index], marker: { app: appIds[index] } })
    }
    await assertSsr(context.request, "1")
    expect(await readViteSnapshots(workspace)).toEqual(snapshots)

    // Exercise both restart origins and repeat the root reload with live HMR and HTTP streams.
    for (const [round, app] of ["root", "web", "root"].entries()) {
      const socketGenerations = socketEvents.map((events) => ({ ...events }))
      const stream = openStream(`${origins[1]}/api/slow-probe`)
      await stream.started
      await replace(
        join(workspace, app, "nuxt.config.ts"),
        'compatibilityDate: "2026-09-12"',
        `compatibilityDate: "2026-09-12", // FULL_RESTART_${round + 1}`,
      )
      const streamOutcome = await Promise.race([stream.finished, timeout(15_000, "pending")])
      stream.request.destroy()
      expect(
        streamOutcome,
        `Full restart ${round + 1} (${app}) left the previous stream open`,
      ).not.toBe("pending")
      await expect
        .poll(
          async () => {
            const ready = await context.request
              .get(`${origins[0]}/__nuxt_multi_app/ready`)
              .then((response) => response.status())
              .catch(() => 0)
            if (ready !== 200) return false
            const next = await readViteSnapshots(workspace).catch(() => [])
            return (
              next.length === snapshots.length &&
              next.every((snapshot, index) => snapshot.socketPath !== snapshots[index]!.socketPath)
            )
          },
          { timeout: 30_000 },
        )
        .toBe(true)
      for (const snapshot of snapshots) await assert.rejects(access(snapshot.socketPath))
      snapshots = await readViteSnapshots(workspace)
      await assertSsr(context.request, "1")
      for (const [index, page] of pages.entries()) {
        await page.goto(origins[index]!)
        await expect(page.getByRole("heading")).toHaveText(`${markers[index]}_HMR_1`)
        await page.waitForFunction(
          (appId) => document.documentElement.dataset.instance === appId,
          appIds[index],
        )
      }
      await expect
        .poll(() =>
          socketEvents.every(
            ({ opened, closed }, index) =>
              opened > socketGenerations[index]!.opened &&
              closed > socketGenerations[index]!.closed,
          ),
        )
        .toBe(true)
    }

    await assertStableRuntime(pages, context.request, "1")
  } finally {
    await context.close()
  }
})

async function assertStableRuntime(pages: Page[], request: APIRequestContext, revision: string) {
  for (let round = 0; round < 4; round++) {
    for (const [index, page] of pages.entries()) {
      await page.reload()
      await expect(page.getByRole("heading")).toHaveText(`${markers[index]}_HMR_${revision}`)
      await page.waitForFunction(
        (appId) => document.documentElement.dataset.instance === appId,
        appIds[index],
      )
    }
  }
  // Interleave SSR of both applications, staying far below the listen backlog (128 on macOS).
  await Promise.all(Array.from({ length: 10 }, () => assertSsr(request, revision)))
}

async function assertSsr(request: APIRequestContext, revision: string) {
  await Promise.all(
    origins.map(async (origin, index) => {
      const response = await request.get(origin)
      expect(response.status()).toBe(200)
      const html = await response.text()
      expect(html).toContain(`${markers[index]}_HMR_${revision}`)
      expect(html).toContain(`${markers[index]}_PLUGIN`)
      expect(html).not.toContain(`${markers[1 - index]}_PLUGIN`)
    }),
  )
}

async function replace(path: string, from: string, to: string) {
  const source = await readFile(path, "utf8")
  assert(source.includes(from), `Missing ${from} in ${path}`)
  await writeFile(path, source.replace(from, to))
}

async function readContextRecords(since: number) {
  const source = await readFile(process.env.NUXT_MULTI_APP_TEST_OUTPUT!, "utf8")
  return source
    .trim()
    .split("\n")
    .map(
      (line) =>
        JSON.parse(line) as {
          start: number
          end: number
          expected: string
          before: string
          after: string
        },
    )
    .filter(({ start }) => start >= since)
}

function openStream(url: string) {
  let started!: () => void
  let finished!: (result: string) => void
  const began = new Promise<void>((resolve) => (started = resolve))
  const ended = new Promise<string>((resolve) => (finished = resolve))
  const request = http.get(url, { agent: false }, (response) => {
    response.once("data", started)
    response.once("end", () => finished("end"))
    response.once("aborted", () => finished("aborted"))
    response.once("close", () => finished(response.complete ? "end" : "close"))
    response.once("error", (error) =>
      finished((error as NodeJS.ErrnoException).code ?? "response-error"),
    )
  })
  request.once("error", (error) => {
    started()
    finished((error as NodeJS.ErrnoException).code ?? "request-error")
  })
  return { started: began, finished: ended, request }
}

function timeout<T>(milliseconds: number, value: T) {
  return new Promise<T>((resolve) => setTimeout(resolve, milliseconds, value))
}
