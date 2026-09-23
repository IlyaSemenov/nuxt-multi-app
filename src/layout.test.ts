import { describe, expect, it } from "bun:test"

import { relativePath } from "./layout"

describe("relative output paths", () => {
  it("prefixes descendants so they are never bare ESM specifiers", () => {
    expect(relativePath("/out/server", "/out/server/index.mjs")).toBe("./index.mjs")
    expect(relativePath("/out/server", "/out/server/.cache/module.mjs")).toBe("./.cache/module.mjs")
  })

  it("keeps parent traversals as they are", () => {
    expect(relativePath("/out/server", "/out/apps/web/server/index.mjs")).toBe(
      "../apps/web/server/index.mjs",
    )
  })
})
