import { describe, expect, it } from "bun:test"
import { resolve } from "node:path"

import type { Nuxt } from "nuxt/schema"

import { normalizeOptions } from "./normalize-options"

const rootDir = resolve(import.meta.dir, "../tests/fixtures/root")
const nuxt = {
  options: { rootDir, buildDir: resolve(rootDir, ".nuxt"), debug: false },
} as Nuxt

describe("path prefix options", () => {
  it("normalizes trailing slashes", () => {
    const options = normalizeOptions({ root: { paths: ["/api/", "/"] } }, nuxt)

    expect(options.root.paths).toEqual(["/api", "/"])
  })

  it("rejects non-path request targets", () => {
    for (const path of ["api", "//api", "/api?private=1", "/api#private", "/api/../private"]) {
      expect(() => normalizeOptions({ root: { paths: [path] } }, nuxt)).toThrow(
        "invalid path prefix",
      )
    }
  })

  it("rejects a prefix assigned to more than one application", () => {
    expect(() =>
      normalizeOptions(
        {
          root: { paths: ["/api/"] },
          apps: [{ id: "web", rootDir: "../web", paths: ["/api"] }],
        },
        nuxt,
      ),
    ).toThrow("path prefix /api is assigned to both root and web")
  })
})
