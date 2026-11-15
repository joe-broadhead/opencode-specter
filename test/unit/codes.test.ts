// One typed code table, and the docs that must match it exactly. A code raised anywhere in src must be in a table,
// every code in the plugin's table must be raised, and the README's Troubleshooting table, the configuration guide's
// Errors table and the scripting doc's refusal table must not drift from them in either direction.
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { CODES, RPC_CODES } from "../../src/constants.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const read = (file: string) => readFileSync(join(ROOT, file), "utf8")

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`
    if (entry.isDirectory()) walk(path, out)
    else if (/\.tsx?$/.test(entry.name)) out.push(path)
  }
  return out
}

const SOURCES = walk("src")
const raised = new Set(
  SOURCES.flatMap((file) => [
    ...[...read(file).matchAll(/"([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)"/g)].map((match) => match[1]!),
    ...[...read(file).matchAll(/["'`]([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+): /g)].map((match) => match[1]!),
  ]),
)
/** The code literals outside the table's own file: a code in the table that nothing raises is dead. */
const raising = SOURCES.filter((file) => file !== "src/constants.ts").map(read).join("\n")

/** The codes in the first cell of a Markdown table row that starts with one, or a row that names several. */
function tableCodes(markdown: string): string[] {
  return markdown
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]?.trim() ?? "")
    .filter((cell) => cell.startsWith("`"))
    .flatMap((cell) => [...cell.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*)`/g)].map((code) => code[1]!))
}

const TROUBLESHOOTING = /## Troubleshooting([\s\S]*?)## Uninstall/.exec(read("README.md"))?.[1] ?? ""
const CONFIGURATION_ERRORS = /## Errors([\s\S]*?)(?=\n## |$)/.exec(read("docs/configuration.md"))?.[1] ?? ""
const SCRIPTING_ERRORS = /## Errors([\s\S]*?)(?=\n## |$)/.exec(read("docs/scripting.md"))?.[1] ?? ""

describe("codes", () => {
  it("every code raised in src is in one of the two tables", () => {
    // ACCOUNT_UNKNOWN and RESOURCE_UNRESOLVED come from the shared tools RPC for features this plugin does not use.
    const known = new Set<string>([...CODES, ...RPC_CODES, "ACCOUNT_UNKNOWN", "RESOURCE_UNRESOLVED"])
    // Not codes: names a source quotes, such as header names written in capitals.
    const plain = new Set(["X_API_KEY"])
    expect([...raised].filter((code) => !known.has(code) && !plain.has(code))).toEqual([])
  })

  it("every code in the plugin's table is raised somewhere", () => {
    expect(CODES.filter((code) => !raising.includes(`"${code}"`))).toEqual([])
  })

  it("the README's Troubleshooting table lists exactly the plugin's codes", () => {
    expect(tableCodes(TROUBLESHOOTING).sort()).toEqual([...CODES].sort())
  })

  it("the configuration guide's Errors table lists exactly the plugin's codes", () => {
    expect(tableCodes(CONFIGURATION_ERRORS).sort()).toEqual([...CODES].sort())
  })

  it("docs/scripting.md's Errors table lists exactly the tools RPC's codes", () => {
    expect(tableCodes(SCRIPTING_ERRORS).sort()).toEqual([...RPC_CODES].sort())
  })
})
