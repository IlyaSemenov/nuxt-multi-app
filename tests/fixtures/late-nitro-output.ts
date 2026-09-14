import { appendFile, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

import { defineNuxtModule } from "nuxt/kit"

const sibling = "late-nitro-output.mjs"

/** Model an integration that creates a server sibling during build and imports it during close. */
export default defineNuxtModule({
  meta: { name: "nuxt-multi-app-late-nitro-output" },
  setup(_options, nuxt) {
    if (nuxt.options.dev || nuxt.options._prepare) return

    nuxt.hook("nitro:init", (nitro) => {
      nitro.hooks.hook("compiled", () =>
        writeFile(resolve(nitro.options.output.serverDir, sibling), "export default true\n"),
      )
      nitro.hooks.hook("close", () =>
        appendFile(
          resolve(nitro.options.output.serverDir, "index.mjs"),
          `\nimport "./${sibling}"\n`,
        ),
      )
    })
  },
})
