import { readFile } from "node:fs/promises"
import process from "node:process"

import { MANIFEST_FILE, type ProductionManifest } from "./contract"
import { createProductionServer } from "./production-server"

const manifest = JSON.parse(
  await readFile(new URL(`./${MANIFEST_FILE}`, import.meta.url), "utf8"),
) as ProductionManifest
const { server, close } = await createProductionServer(manifest, import.meta.url)

let shutdownStarted = false
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shutdownStarted) return
    shutdownStarted = true
    close().then(
      () => process.exit(0),
      (error) => {
        console.error("[nuxt-multi-app] shutdown failed", error)
        process.exit(1)
      },
    )
  })
}

// Same precedence as Nitro's node-server preset.
const port = Number(process.env.NITRO_PORT || process.env.PORT) || 3000
const host = process.env.NITRO_HOST || process.env.HOST
server.listen(port, host, () => {
  const address = server.address()
  const origin =
    typeof address === "string" || !address
      ? String(address)
      : `http://${address.address}:${address.port}`
  console.log(`[nuxt-multi-app] listening on ${origin}; PID=${process.pid}`)
  console.log(`[nuxt-multi-app] routing: ${manifest.routing.length} ordered rules`)
  for (const [index, rule] of manifest.routing.entries()) {
    const guards = [
      rule.hosts && `hosts ${rule.hosts.join(", ")}`,
      rule.paths && `paths ${rule.paths.join(", ")}`,
    ]
      .filter(Boolean)
      .join(" and ")
    const target = "app" in rule ? rule.app : "resolver"
    console.log(`[nuxt-multi-app] rule ${index + 1}: ${guards || "*"} -> ${target}`)
  }
})
