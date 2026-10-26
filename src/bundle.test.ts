import { afterAll, describe, expect, it } from "bun:test"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

import { bundleForOutput, type NitroOutputSettings } from "./bundle"

const workspace = realpathSync(mkdtempSync(join(tmpdir(), "nuxt-multi-app-bundle-")))
afterAll(() => rmSync(workspace, { recursive: true, force: true }))

const dependency = join(workspace, "node_modules/licensed-probe")
mkdirSync(dependency, { recursive: true })
writeFileSync(join(dependency, "package.json"), '{"name":"licensed-probe","main":"index.js"}')
writeFileSync(
  join(dependency, "index.js"),
  "/** @license licensed-probe MIT */\nexport function describeProbe() { return 'probe' }\n",
)
const input = join(workspace, "entry.js")
writeFileSync(
  input,
  [
    'import { describeProbe } from "licensed-probe"',
    "export function greetVisitor(name) { return `${describeProbe()} ${name}` }",
    "export class VisitorGreeter {}",
    "export const names = [greetVisitor.name, VisitorGreeter.name]",
  ].join("\n"),
)

let builds = 0
async function bundle(settings?: NitroOutputSettings) {
  const output = join(workspace, `out-${++builds}`, "index.mjs")
  await bundleForOutput(input, output, settings)
  const map = `${output}.map`
  return {
    code: readFileSync(output, "utf8"),
    map: existsSync(map) ? JSON.parse(readFileSync(map, "utf8")) : undefined,
    names: ((await import(pathToFileURL(output).href)) as { names: string[] }).names,
  }
}

describe("bundleForOutput", () => {
  it("keeps readable code and a linked map with sources without settings", async () => {
    const { code, map } = await bundle()
    expect(code).toContain("function greetVisitor(name)")
    expect(code).toContain("//# sourceMappingURL=index.mjs.map")
    expect(map.sourcesContent).toBeArray()
  })

  it("leaves code readable when Nitro does not minify", async () => {
    const { code } = await bundle({ minify: false, sourceMap: true })
    expect(code).toContain("function greetVisitor(name)")
  })

  it("minifies while keeping names and dependency license comments", async () => {
    const { code, names } = await bundle({ minify: true, sourceMap: false })
    expect(code).not.toContain("function greetVisitor(name)")
    expect(code).toContain("@license licensed-probe MIT")
    expect(names).toEqual(["greetVisitor", "VisitorGreeter"])
  })

  for (const [sourceMap, file, comment] of [
    [true, true, "//# sourceMappingURL=index.mjs.map"],
    ["hidden", true, undefined],
    ["inline", false, "//# sourceMappingURL=data:"],
    [false, false, undefined],
  ] as const) {
    it(`follows sourceMap ${JSON.stringify(sourceMap)} without embedding sources`, async () => {
      const { code, map } = await bundle({ minify: false, sourceMap })
      expect(map !== undefined).toBe(file)
      if (map) expect(map.sourcesContent).toBeUndefined()
      if (comment) expect(code).toContain(comment)
      else expect(code).not.toContain("sourceMappingURL")
      if (sourceMap === "inline") {
        const inline = code.match(/sourceMappingURL=data:application\/json;base64,(\S+)/)![1]!
        expect(JSON.parse(Buffer.from(inline, "base64").toString()).sourcesContent).toBeUndefined()
      }
    })
  }
})
