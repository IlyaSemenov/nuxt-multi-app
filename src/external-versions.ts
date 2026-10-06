// Production check for Nitro 2 external imports that would load a package version other than the
// one their importer resolves (https://github.com/nitrojs/nitro/issues/4731).
import { readFileSync, realpathSync } from "node:fs"
import { dirname, isAbsolute, join, relative, sep } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import type {} from "@nuxt/nitro-server"
import { resolveModuleURL } from "exsolve"
import type { Nitro } from "nitropack/types"
import type { Nuxt } from "nuxt/schema"
import type { Plugin } from "rollup"
import { compare, valid } from "semver"

import { type ExternalImport, observeNitroExternals } from "./nuxt/compat"

const NITRO_ISSUE = "https://github.com/nitrojs/nitro/issues/4731"
const LISTED_IMPORTERS = 3
/**
 * Conditions Node applies to the bundle's ESM imports at run time, unlike Nitro's build conditions;
 * every supported Node release enables `module-sync` and `node-addons` by default.
 */
const RUNTIME_CONDITIONS = ["node", "import", "module-sync", "node-addons"]

/**
 * Fail an application's production build when its Nitro bundle imports different versions of one
 * external package, or when an external import would load another version from the output.
 *
 * Nitro replaces each such import with the bare package specifier, so imports of two installed
 * versions collapse into one, and its output keeps only one version under the bare name.
 */
export function checkExternalVersions(nuxt: Nuxt, appId: string, apps: AppDirectory[]) {
  nuxt.hook("nitro:init", (nitro) => checkNitroExternalVersions(nitro, appId, apps))
}

/** An application of the composition, used to show file paths relative to their owner. */
export interface AppDirectory {
  id: string
  rootDir: string
}

/** Add the external version check to the next production build of a Nitro instance. */
export function checkNitroExternalVersions(
  nitro: Nitro,
  appId: string,
  apps: AppDirectory[] = [{ id: appId, rootDir: nitro.options.rootDir }],
) {
  nitro.hooks.hook("rollup:before", (_nitro, config) => {
    // Without externals every package is bundled from its importer's own resolution.
    if (nitro.options.noExternals) return
    const imports = new Map<string, ExternalImport>()
    observeNitroExternals(nitro, config, (entry) => {
      imports.set([entry.importer, entry.id, entry.file].join("\0"), entry)
    })
    config.plugins = [config.plugins, externalVersionsPlugin(nitro, appId, apps, imports)]
  })
}

interface PackageVersion {
  name: string
  version: string
}

interface VersionedImport extends ExternalImport {
  pkg: PackageVersion
}

function externalVersionsPlugin(
  nitro: Nitro,
  appId: string,
  apps: AppDirectory[],
  collected: Map<string, ExternalImport>,
): Plugin {
  return {
    name: "nuxt-multi-app:external-versions",
    // Errors from the write phase reach the caller once; Nitro logs earlier build errors itself.
    generateBundle() {
      const packages = new PackageLookup()
      // Imports removed by tree shaking count too: Nitro packages every version it resolved.
      const imports = [...collected.values()].flatMap((entry) => {
        const pkg = packages.at(entry.file)
        return pkg ? [{ ...entry, pkg }] : []
      })
      const display = displayPath(appId, apps)
      const conflicts = [...groupByPackage(imports)].filter(([, versions]) => versions.size > 1)
      if (conflicts.length > 0) this.error(conflictMessage(appId, display, conflicts))
      // Nitro has traced the packages by now; external parents can still win the top-level copy.
      const mismatches = outputMismatches(nitro, imports, packages)
      if (mismatches.length > 0) this.error(mismatchMessage(appId, display, mismatches))
    },
  }
}

/** Group imports by package name and then by version. */
function groupByPackage(imports: VersionedImport[]) {
  const packages = new Map<string, Map<string, VersionedImport[]>>()
  for (const entry of imports) {
    let versions = packages.get(entry.pkg.name)
    if (!versions) packages.set(entry.pkg.name, (versions = new Map()))
    versions.set(entry.pkg.version, [...(versions.get(entry.pkg.version) ?? []), entry])
  }
  return packages
}

/** Finds the nearest named and versioned `package.json` above a file. */
class PackageLookup {
  #directories = new Map<string, PackageVersion | null>()

  at(file: string) {
    return this.#find(dirname(realpathSync(file)))
  }

  #find(dir: string): PackageVersion | null {
    const cached = this.#directories.get(dir)
    if (cached !== undefined) return cached
    let found: PackageVersion | null = null
    try {
      const { name, version } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
      // Nested manifests such as `dist/package.json` only set the module type; keep looking.
      if (typeof name === "string" && typeof version === "string") found = { name, version }
    } catch (error) {
      // A malformed manifest cannot name the package either.
      const code = (error as NodeJS.ErrnoException).code
      if (!(error instanceof SyntaxError) && code !== "ENOENT" && code !== "ENOTDIR") throw error
    }
    const parent = dirname(dir)
    if (!found && parent !== dir) found = this.#find(parent)
    this.#directories.set(dir, found)
    return found
  }
}

interface Mismatch {
  entry: VersionedImport
  output: string | undefined
  pkg: PackageVersion | null | undefined
}

/** Resolve each emitted specifier inside the finished output, after Nitro has traced packages. */
function outputMismatches(nitro: Nitro, imports: VersionedImport[], packages: PackageLookup) {
  // Read the directory now: the root application moves its output after Nitro is created.
  const serverDir = nitro.options.output.serverDir
  const outputRoot = realpathSync(serverDir)
  const from = pathToFileURL(join(serverDir, "index.mjs"))
  const resolved = new Map<string, string | undefined>()
  const mismatches: Mismatch[] = []
  for (const entry of imports) {
    if (!resolved.has(entry.id)) {
      const url = resolveModuleURL(entry.id, {
        try: true,
        conditions: RUNTIME_CONDITIONS,
        from,
      })
      resolved.set(entry.id, url?.startsWith("file:") ? fileURLToPath(url) : undefined)
    }
    const output = resolved.get(entry.id)
    // A package resolved outside the output would not exist once the output is deployed.
    const pkg =
      output && realpathSync(output).startsWith(outputRoot + sep) ? packages.at(output) : undefined
    if (pkg?.name !== entry.pkg.name || pkg.version !== entry.pkg.version) {
      mismatches.push({ entry, output, pkg })
    }
  }
  return mismatches
}

/**
 * Show a path relative to the application directory it is closest to, marking directories of
 * other applications, such as root code mounted into a child, with their ID.
 */
function displayPath(appId: string, apps: AppDirectory[]) {
  // The current application wins ties; real paths match files that resolution reports.
  const roots = [...apps]
    .sort((a, b) => Number(b.id === appId) - Number(a.id === appId))
    .flatMap(({ id, rootDir }) => [rootDir, realpathSync(rootDir)].map((dir) => ({ id, dir })))
  return (path: string) => {
    if (!isAbsolute(path)) return path.replace(/^\0/, "")
    let best: { id: string; path: string; up: number } | undefined
    for (const { id, dir } of roots) {
      const candidate = relative(dir, path)
      const up = candidate.split(sep).filter((segment) => segment === "..").length
      if (!best || up < best.up) best = { id, path: candidate, up }
    }
    return best!.id === appId ? best!.path : `[${best!.id}] ${best!.path}`
  }
}

function compareVersions(a: string, b: string) {
  return valid(a) && valid(b) ? compare(a, b) : a.localeCompare(b)
}

function conflictMessage(
  appId: string,
  display: (path: string) => string,
  conflicts: [string, Map<string, VersionedImport[]>][],
) {
  const lines = [
    `App "${appId}" bundles imports that resolve to different versions of the same external package.`,
    `Nitro replaces each of them with the bare package import, so production would load one version for all of them (${NITRO_ISSUE}).`,
    "Imports that tree shaking removes count as well: Nitro still packages the version they resolve to, and that version can replace the one the remaining imports need.",
  ]
  for (const [name, versions] of conflicts.sort(([a], [b]) => a.localeCompare(b))) {
    lines.push("", name)
    for (const [version, entries] of [...versions].sort(([a], [b]) => compareVersions(a, b))) {
      lines.push(`  ${version}`, ...importLines(display, entries, "    "))
    }
  }
  lines.push(
    "",
    "Remove the imports of the version that is not needed, install one version of each package for these importers,",
    ...inlineLines(conflicts.map(([name]) => name)),
  )
  return lines.join("\n")
}

function mismatchMessage(appId: string, display: (path: string) => string, mismatches: Mismatch[]) {
  const lines = [
    `App "${appId}" production output resolves external imports to package versions they were not resolved to while bundling.`,
    `Nitro emits bare package imports and keeps one version of each package at the top of its output, preferring a version that other external packages do not depend on (${NITRO_ISSUE}).`,
  ]
  const groups = new Map<string, Mismatch[]>()
  for (const mismatch of mismatches) {
    const key = [mismatch.entry.pkg.name, mismatch.entry.pkg.version, mismatch.entry.id].join("\0")
    groups.set(key, [...(groups.get(key) ?? []), mismatch])
  }
  for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const { entry, output, pkg } = group[0]!
    const found = pkg
      ? `${pkg.name}@${pkg.version}`
      : output
        ? "a file outside the output"
        : "nothing"
    lines.push(
      "",
      `${entry.pkg.name}: imported as ${entry.pkg.version}, the output provides ${found}`,
      ...importLines(
        display,
        group.map((mismatch) => mismatch.entry),
        "  ",
      ),
      `  output: ${output ? display(output) : `"${entry.id}" does not resolve`}`,
    )
  }
  lines.push(
    "",
    "Install the version these importers need for the external packages as well,",
    ...inlineLines([...new Set(mismatches.map((mismatch) => mismatch.entry.pkg.name))]),
  )
  return lines.join("\n")
}

/** List importers per emitted specifier and resolved file, abbreviating long lists. */
function importLines(
  display: (path: string) => string,
  entries: VersionedImport[],
  indent: string,
) {
  const targets = new Map<string, VersionedImport[]>()
  for (const entry of entries) {
    const key = `${entry.id}\0${entry.file}`
    targets.set(key, [...(targets.get(key) ?? []), entry])
  }
  return [...targets.values()].flatMap((group) => {
    const importers = [...new Set(group.map((entry) => display(entry.importer)))].sort()
    const listed = importers
      .slice(0, LISTED_IMPORTERS)
      .map((importer) => `${indent}  from ${importer}`)
    const rest = importers.length - listed.length
    return [
      `${indent}"${group[0]!.id}" -> ${display(group[0]!.file)}`,
      ...listed,
      ...(rest > 0 ? [`${indent}  and ${rest} more ${rest === 1 ? "importer" : "importers"}`] : []),
    ]
  })
}

function inlineLines(names: string[]) {
  const list = names
    .sort()
    .map((name) => JSON.stringify(name))
    .join(", ")
  return [
    "or add the packages to nitro.externals.inline of this application, in apps[].overrides.nitro for a mounted child:",
    `  nitro: { externals: { inline: [${list}] } }`,
    "Bundled packages bring their own imports into the bundle, which this check then verifies as well.",
  ]
}
