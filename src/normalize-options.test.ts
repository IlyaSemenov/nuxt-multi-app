import { describe, expect, it, spyOn } from "bun:test"
import { resolve } from "node:path"

import type { Nuxt } from "nuxt/schema"

import { logger } from "./logger"
import { normalizeOptions } from "./normalize-options"

const rootDir = resolve(import.meta.dir, "../tests/fixtures/root")
const nuxt = {
  options: { rootDir, buildDir: resolve(rootDir, ".nuxt"), debug: false },
} as Nuxt

describe("routing options", () => {
  it("requires a non-empty routing list for every composition", () => {
    expect(() => normalizeOptions({} as never, nuxt)).toThrow("routing is required")
    expect(() => normalizeOptions({ routing: [] }, nuxt)).toThrow("routing must not be empty")
    expect(normalizeOptions({ routing: [{ app: "root" }] }, nuxt).routing).toEqual([
      { app: "root", hosts: undefined, paths: undefined },
    ])
  })

  it("normalizes rule guards and resolves resolver modules", () => {
    const options = normalizeOptions(
      {
        apps: [{ id: "web", rootDir: "../web" }],
        routing: [
          { paths: ["/api/", "/"], app: "web" },
          { hosts: ["EXAMPLE.TEST."], resolver: "./resolver.ts" },
        ],
      },
      nuxt,
    )

    expect(options.routing).toEqual([
      { app: "web", hosts: undefined, paths: ["/api", "/"] },
      {
        resolver: resolve(rootDir, "resolver.ts"),
        hosts: ["example.test"],
        paths: undefined,
      },
    ])
  })

  it("rejects invalid rules before startup", () => {
    expect(() => normalizeOptions({ routing: [{} as never] }, nuxt)).toThrow(
      "must define exactly one",
    )
    expect(() =>
      normalizeOptions({ routing: [{ app: "root", resolver: "./resolver.ts" } as never] }, nuxt),
    ).toThrow("must define exactly one")
    expect(() => normalizeOptions({ routing: [{ app: "missing" }] }, nuxt)).toThrow(
      "unknown application missing",
    )
    expect(() => normalizeOptions({ routing: [{ app: "root" }, { app: "root" }] }, nuxt)).toThrow(
      "must be the last rule",
    )
    expect(() => normalizeOptions({ routing: [{ app: "root", hosts: [] }] }, nuxt)).toThrow(
      "hosts must not be empty",
    )
  })

  it("rejects invalid path request targets", () => {
    for (const path of ["api", "//api", "/api?private=1", "/api#private", "/api/../private"]) {
      expect(() => normalizeOptions({ routing: [{ app: "root", paths: [path] }] }, nuxt)).toThrow(
        "invalid path prefix",
      )
    }
  })

  it("warns about statically unreachable applications when there is no resolver", () => {
    const warn = spyOn(logger, "warn")
    try {
      normalizeOptions(
        {
          apps: [{ id: "web", rootDir: "../web" }],
          routing: [{ app: "root" }],
        },
        nuxt,
      )
      expect(warn).toHaveBeenCalledWith("application web is not referenced by any routing rule")
    } finally {
      warn.mockRestore()
    }
  })
})
