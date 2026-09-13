import assert from "node:assert/strict"
import { readFile, realpath } from "node:fs/promises"
import { join } from "node:path"

/** Read the bridge literals actually shipped to Nitro workers, independently of the shared env. */
export async function readViteSnapshots(workspace: string) {
  return Promise.all(
    ["root/.nuxt", "web/.nuxt-multi-app/web"].map(async (buildDir, index) => {
      const source = await readFile(join(workspace, buildDir, "dev/index.mjs"), "utf8")
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
