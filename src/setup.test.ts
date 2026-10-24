import { afterAll, describe, expect, it } from "bun:test"
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { Nuxt } from "nuxt/schema"

import { setupModule } from "./setup"

const workspace = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-multi-app-")))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

// The root and the child each have their own installation of one package.
for (const app of ["root", "child"]) {
  const dir = join(workspace, app, "node_modules/shared-probe")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "package.json"), '{"name":"shared-probe","version":"1.0.0"}')
}

describe("shared dependencies", () => {
  for (const [mode, flags] of [
    ["prepare", { _prepare: true, dev: false }],
    ["development", { _prepare: false, dev: true }],
    ["production build", { _prepare: false, dev: false }],
  ] as const) {
    it(`fails ${mode} setup before registering any Nuxt hook`, async () => {
      const hooks: string[] = []
      const nuxt = {
        options: {
          rootDir: join(workspace, "root"),
          buildDir: join(workspace, "root/.nuxt"),
          watch: [],
          ...flags,
        },
        hook: (name: string) => void hooks.push(name),
      } as unknown as Nuxt

      await expect(
        setupModule(
          {
            apps: [{ id: "child", rootDir: "../child", sharedDependencies: ["shared-probe"] }],
            routing: [{ paths: ["/child"], app: "child" }, { app: "root" }],
          },
          nuxt,
        ),
      ).rejects.toThrow('shared-probe in app "child"')
      expect(hooks).toEqual([])
    })
  }
})
