import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { NormalizedAppOptions, NormalizedModuleOptions } from "./options"
import { assertSharedDependencies } from "./shared-dependencies"

const workspace = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-multi-app-")))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

/** Install a package into a `node_modules` directory, as a package manager would. */
function installPackage(modules: string, name: string, manifest: Record<string, unknown> = {}) {
  const dir = join(modules, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "1.0.0", ...manifest }))
  return dir
}

function app(id: string, rootDir: string, sharedDependencies: string[] = []): NormalizedAppOptions {
  mkdirSync(rootDir, { recursive: true })
  const buildDir = join(rootDir, ".nuxt")
  return { id, rootDir, buildDir, overrides: {}, sharedDependencies, isRoot: false }
}

function check(...apps: NormalizedAppOptions[]) {
  const root = { ...app("root", join(workspace, "apps/root")), isRoot: true }
  assertSharedDependencies({ root, apps, allApps: [root, ...apps] } as NormalizedModuleOptions)
}

// One workspace install hoists packages for the root and for a nested checkout of the child.
const hoisted = join(workspace, "node_modules")
const sharedProbe = installPackage(hoisted, "shared-probe", { exports: "./index.js" })
// Only a subpath is exported, so neither the package nor its manifest resolves through exports.
installPackage(hoisted, "@probe/subpath-only", { exports: { "./client": "./client.js" } })
installPackage(hoisted, "types-only-probe", { types: "./index.d.ts" })
// Isolated installs link each importer's dependency to one store directory.
const store = installPackage(join(workspace, "node_modules/.store"), "linked-probe")
mkdirSync(join(workspace, "apps/root/node_modules"), { recursive: true })
symlinkSync(store, join(workspace, "apps/root/node_modules/linked-probe"))

describe("shared dependencies", () => {
  it("accepts packages that resolve to one installed directory from both applications", () => {
    const childModules = join(workspace, "apps/root/child/node_modules")
    mkdirSync(childModules, { recursive: true })
    symlinkSync(store, join(childModules, "linked-probe"))

    expect(() =>
      check(
        app("child", join(workspace, "apps/root/child"), [
          "shared-probe",
          "@probe/subpath-only",
          "types-only-probe",
          "linked-probe",
        ]),
      ),
    ).not.toThrow()
  })

  it("rejects a child that has its own installation of a shared package", () => {
    const separateRoot = join(workspace, "apps/root/separate")
    const separateCopy = installPackage(join(separateRoot, "node_modules"), "shared-probe")

    expect(() => check(app("separate", separateRoot, ["shared-probe"]))).toThrow(
      [
        'shared-probe in app "separate"',
        `  root "root": ${sharedProbe}`,
        `  child "separate": ${separateCopy}`,
        "",
        "Different directories mean the child was most likely installed separately from the root",
      ].join("\n"),
    )
  })

  it("rejects a shared package that does not resolve from one of the applications", () => {
    const childRoot = join(workspace, "apps/root/missing")
    installPackage(join(childRoot, "node_modules"), "child-only-probe")

    let message = ""
    try {
      check(app("missing", childRoot, ["child-only-probe"]))
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain(
      [
        'child-only-probe in app "missing"',
        `  root "root": not installed (looked up from ${join(workspace, "apps/root")})`,
        `  child "missing": ${join(childRoot, "node_modules/child-only-probe")}`,
      ].join("\n"),
    )
    expect(message).toContain("Install missing packages for the application")
    expect(message).not.toContain("installed separately")
  })

  it("reports every mismatched package of every child at once", () => {
    installPackage(join(workspace, "outside/first/node_modules"), "shared-probe")
    const first = app("first", join(workspace, "outside/first"), ["shared-probe"])
    // The root reaches this package through its own link only.
    const second = app("second", join(workspace, "outside/second"), ["linked-probe"])

    expect(() => check(first, second)).toThrow(
      /shared-probe in app "first"[^]*linked-probe in app "second"/,
    )
  })
})
