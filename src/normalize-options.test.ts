import { afterAll, describe, expect, it, spyOn } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
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

describe("application directories", () => {
  const webRoot = resolve(rootDir, "../web")
  const mount = (input: { buildDir?: string }, root: Nuxt = nuxt) =>
    normalizeOptions(
      { apps: [{ id: "web", rootDir: "../web", ...input }], routing: [{ app: "web" }] },
      root,
    ).apps[0]!.buildDir

  it("places a mounted build directory in the child's own build cache", () => {
    expect(mount({})).toMatch(
      new RegExp(`^${webRoot}/\\.nuxt/cache/nuxt-multi-app/root-[0-9a-f]{12}$`),
    )
  })

  it("separates the build directories of roots that mount the same child", () => {
    const otherRoot = {
      options: { ...nuxt.options, buildDir: resolve(rootDir, ".generated/root") },
    } as Nuxt

    expect(mount({})).toBe(mount({}))
    expect(mount({}, otherRoot)).not.toBe(mount({}))
  })

  it("resolves an explicit build directory from the root application", () => {
    expect(mount({ buildDir: ".nuxt/multi-app/web" })).toBe(resolve(rootDir, ".nuxt/multi-app/web"))
  })

  it("rejects the child's standalone build directory", () => {
    expect(() => mount({ buildDir: "../web/.nuxt" })).toThrow("standalone build directory")
  })

  it("rejects an explicit build directory shared with the root", () => {
    expect(() => mount({ buildDir: ".nuxt" })).toThrow(
      "buildDir is shared by multiple applications",
    )
  })

  describe("through symbolic links", () => {
    const temp = realpathSync(mkdtempSync(resolve(tmpdir(), "nuxt-multi-app-")))
    afterAll(() => rmSync(temp, { recursive: true, force: true }))

    // The link sits at a different depth than the root it points to.
    const linkedRootDir = resolve(temp, "checkout/root")
    mkdirSync(resolve(temp, "checkout"))
    symlinkSync(rootDir, linkedRootDir)
    const rootAt = (root: string, buildDir: string) =>
      ({ options: { ...nuxt.options, rootDir: root, buildDir } }) as Nuxt

    it("shares the build directories of one root reached by different paths", () => {
      expect(mount({}, rootAt(linkedRootDir, resolve(linkedRootDir, ".nuxt")))).toBe(mount({}))
    })

    it("separates roots whose build directories are physically different", () => {
      const external = mount({}, rootAt(linkedRootDir, resolve(temp, "build/.nuxt")))
      // The same relative path from the physical root, where a lexical mapping would land.
      const lexicalTwin = mount({}, rootAt(rootDir, resolve(rootDir, "../../build/.nuxt")))

      expect(external).not.toBe(lexicalTwin)
    })

    it("rejects a build directory linked to the build directory of another application", () => {
      const link = resolve(temp, "root-build")
      symlinkSync(resolve(rootDir, ".nuxt"), link)

      expect(() => mount({ buildDir: link })).toThrow("buildDir is shared by multiple applications")
    })

    it("rejects a link to the child's standalone build directory", () => {
      const link = resolve(temp, "web-build")
      symlinkSync(resolve(webRoot, ".nuxt"), link)

      expect(() => mount({ buildDir: link })).toThrow("standalone build directory")
    })
  })
})
