import assert from "node:assert/strict"
import { readdir, readFile, realpath } from "node:fs/promises"
import { join } from "node:path"

/** Find the single build directory the root generated for the mounted `web` child in its own tree. */
export async function mountedWebBuildDir(workspace: string) {
  const cacheDir = join(workspace, "web/.nuxt/cache/nuxt-multi-app")
  const entries = await readdir(cacheDir)
  assert.equal(entries.length, 1, "The mounted child must have exactly one build directory")
  return join(cacheDir, entries[0]!)
}

/** Read the bridge literals actually shipped to Nitro workers, independently of the shared env. */
export async function readViteSnapshots(workspace: string) {
  const buildDirs = [join(workspace, "root/.nuxt"), await mountedWebBuildDir(workspace)]
  return Promise.all(
    buildDirs.map(async (buildDir, index) => {
      const source = await readFile(join(buildDir, "dev/index.mjs"), "utf8")
      const literal = source.match(/const envVar = (".*");/)
      assert(literal, "The Nitro worker must contain a literal Vite bridge snapshot")
      const snapshot = JSON.parse(JSON.parse(literal[1]!)) as { root: string; socketPath: string }
      assert.equal(
        await realpath(snapshot.root),
        await realpath(join(workspace, index ? "web/app" : "root/app")),
      )
      assert(snapshot.socketPath, "The Vite bridge must have an IPC address")
      return snapshot
    }),
  )
}
