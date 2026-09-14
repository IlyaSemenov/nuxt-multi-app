import { mkdir } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"

import { build } from "esbuild"
import type { BuildOptions, Plugin } from "esbuild"
import type { Nuxt } from "nuxt/schema"

interface BundleForOutputOptions {
  define?: BuildOptions["define"]
  plugins?: Plugin[]
}

/** Bundle one ESM entry with every dependency inlined, so the output runs without node_modules. */
export async function bundleForOutput(
  input: string,
  output: string,
  options: BundleForOutputOptions = {},
) {
  await mkdir(dirname(output), { recursive: true })
  await build({
    entryPoints: [input],
    outfile: output,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    sourcemap: true,
    packages: "bundle",
    ...options,
  })
}

/** Bundle project-owned routing code so the generated Nitro output remains portable. */
export function bundleProjectModule(input: string, output: string, nuxt: Nuxt) {
  return bundleForOutput(input, output, {
    // Project modules execute beside Nitro handlers, so expose the same live environment contract.
    define: { "import.meta.env": "process.env" },
    plugins: [projectHelpers(), nuxtAliases(nuxt.options.alias)],
  })
}

function projectHelpers(): Plugin {
  return {
    name: "nuxt-multi-app-project-helpers",
    setup(build) {
      // Project modules are copied into portable output, so replace the package import with the
      // two dependency-free identity helpers instead of bundling or externalizing the Nuxt module.
      build.onResolve({ filter: /^nuxt-multi-app$/ }, () => ({
        path: "project-helpers",
        namespace: "nuxt-multi-app",
      }))
      build.onLoad({ filter: /.*/, namespace: "nuxt-multi-app" }, () => ({
        contents: [
          "export const defineMultiAppResolver = factory => factory",
          "export const defineMultiAppStateHandler = factory => factory",
        ].join("\n"),
        loader: "js",
      }))
    },
  }
}

function nuxtAliases(aliases: Record<string, string>): Plugin {
  const entries = Object.entries(aliases)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .sort(([left], [right]) => right.length - left.length)

  return {
    name: "nuxt-multi-app-aliases",
    setup(build) {
      build.onResolve({ filter: /.*/ }, async (args) => {
        if ((args.pluginData as { aliasResolved?: boolean } | undefined)?.aliasResolved) return
        const alias = entries.find(
          ([name]) => args.path === name || args.path.startsWith(`${name}/`),
        )
        if (!alias) return
        const [name, replacement] = alias
        const path = `${replacement}${args.path.slice(name.length)}`
        return build.resolve(path, {
          importer: args.importer,
          kind: args.kind,
          namespace: args.namespace,
          resolveDir: isAbsolute(replacement) ? dirname(replacement) : args.resolveDir,
          pluginData: { aliasResolved: true },
        })
      })
    },
  }
}
