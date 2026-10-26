import { mkdir } from "node:fs/promises"
import { dirname, isAbsolute } from "node:path"

import { build } from "esbuild"
import type { BuildOptions, Plugin } from "esbuild"
import type { NitroOptions } from "nitropack/types"
import type { Nuxt } from "nuxt/schema"

/** The root application's Nitro settings that bundles written into the production output follow. */
export interface NitroOutputSettings {
  minify: boolean
  sourceMap: NitroOptions["sourceMap"]
}

interface BundleForOutputOptions {
  define?: BuildOptions["define"]
  plugins?: Plugin[]
}

/**
 * Bundle one ESM entry with every dependency inlined, so the output runs without node_modules.
 * Without `settings`, the bundle is readable and has a linked source map with sources.
 */
export async function bundleForOutput(
  input: string,
  output: string,
  settings?: NitroOutputSettings,
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
    packages: "bundle",
    ...(settings ? toEsbuildOutput(settings) : { sourcemap: true }),
    ...options,
  })
}

/** Bundle project-owned routing code so the generated Nitro output remains portable. */
export function bundleProjectModule(
  input: string,
  output: string,
  nuxt: Nuxt,
  settings?: NitroOutputSettings,
) {
  return bundleForOutput(input, output, settings, {
    // Project modules execute beside Nitro handlers, so expose the same live environment contract.
    define: { "import.meta.env": "process.env" },
    plugins: [projectHelpers(), nuxtAliases(nuxt.options.alias)],
  })
}

/** Map Nitro output settings to esbuild options that match Nitro's own server bundles. */
function toEsbuildOutput({ minify, sourceMap }: NitroOutputSettings): BuildOptions {
  return {
    // Nitro's terser keeps function and class names, so stack frames and error names stay readable.
    ...(minify ? { minify: true, keepNames: true } : {}),
    sourcemap: sourceMap === "hidden" ? "external" : sourceMap === true ? "linked" : sourceMap,
    // Nitro excludes sources from its maps, so shipped maps do not reveal the original code.
    sourcesContent: false,
  }
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
          "export const defineMultiAppFallback = factory => factory",
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
