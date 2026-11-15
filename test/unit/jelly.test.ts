import { describe, expect, it } from "vitest"
import { KEY_INTEGRATION_ID, SERVER_NAME } from "../../src/constants.js"
import { loadOptions, REQUEST_TIMEOUT } from "../../src/options.js"
import { defaultRules } from "../../src/permissions.js"
import { SKILL_IDS } from "../../src/skills.js"
import { MCP_TOOLS } from "../../src/specter-tools.js"
import { OWN_SPECS } from "../../src/tool-spec.js"
import { TOOL_PREFIX } from "../../src/tools.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, effectFromRules, readPackage } from "../support/jelly-kit.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. The shared kit checks it against
 * Jelly's plugin authors' standard; the tests below add what only Specter declares. Jelly's agents have no base
 * "allow everything" rule, so the plugin's own default rules never reach them; Jelly writes each declared `ask` or
 * `deny` as that tool's default instead.
 */

const ROOT = new URL("../../", import.meta.url)
const manifest = readPackage(ROOT)
const jelly = manifest.jelly as Declaration & { rpc: unknown[]; views: unknown[]; contributes: Record<string, unknown[]> & { settings: PluginSetting[] }; tools: DeclaredTool[] }

/** Every classified tool, Specter's MCP tools and the plugin's own, by permission, with whether it is read-only. */
function knownTools(): Map<string, boolean> {
  const known = new Map<string, boolean>()
  for (const [name, toolClass] of Object.entries(MCP_TOOLS)) known.set(`${TOOL_PREFIX}${name}`, toolClass === "read")
  for (const spec of OWN_SPECS) known.set(spec.action, spec.class === "read")
  return known
}

describe("the jelly declaration", () => {
  it("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    const problems = declarationProblems(ROOT, { effectOf: effectFromRules(defaultRules()) })
    // TODO(Slice 3, Slice 7): no tool is declared until the capture and the first own tools; then this is [].
    const expected = jelly.tools.length === 0 ? ["jelly.tools is empty"] : []
    expect(problems).toEqual(expected)
  })

  it("declares exactly the classified tools, marking the reads read-only: in step with the tool table", () => {
    const known = knownTools()
    const declared = new Map(jelly.tools.map((tool) => [tool.permission, tool.readOnly === true]))
    expect([...declared.keys()].sort()).toEqual([...known.keys()].sort())
    for (const [permission, readOnly] of known) expect(declared.get(permission), permission).toBe(readOnly)
  })

  it("declares the skills the plugin registers", () => {
    expect(jelly.skills).toEqual([...SKILL_IDS])
  })

  it("declares two sign-ins in one group: the MCP account and the team key", () => {
    expect(jelly.signIns).toEqual([
      { id: "account", label: "Specter account", server: SERVER_NAME, group: "specter" },
      { id: "specter", label: "Specter", integration: KEY_INTEGRATION_ID, group: "specter" },
    ])
  })

  it("declares only the keys opencode-github declares, and no RPC methods, views or other contributions", () => {
    expect(Object.keys(jelly)).toEqual(["title", "summary", "icon", "tools", "skills", "rpc", "views", "signIns", "contributes"])
    expect(jelly.rpc).toEqual([])
    expect(jelly.views).toEqual([])
    expect(jelly.contributes.homeFeeds).toEqual([])
    expect(jelly.contributes.homeWidgets).toEqual([])
    expect(jelly.contributes.workKinds).toEqual([])
  })

  it("declares access and requestTimeoutMs, with the options parser's defaults and bounds", () => {
    const settings = jelly.contributes.settings
    expect(settings.map((setting) => [setting.key, setting.type])).toEqual([["access", "string"], ["requestTimeoutMs", "number"]])
    const defaults = loadOptions({})
    for (const setting of settings) expect(setting.default).toBe(defaults[setting.key as "access" | "requestTimeoutMs"])
    const timeout = settings.find((setting) => setting.key === "requestTimeoutMs")!
    expect({ integer: timeout.integer, min: timeout.min, max: timeout.max, default: timeout.default }).toEqual({ integer: true, ...REQUEST_TIMEOUT })
    expect(() => loadOptions({ requestTimeoutMs: REQUEST_TIMEOUT.min - 1 })).toThrow(/OPTIONS_INVALID/)
    expect(() => loadOptions({ requestTimeoutMs: REQUEST_TIMEOUT.max + 1 })).toThrow(/OPTIONS_INVALID/)
    expect(() => loadOptions({ requestTimeoutMs: REQUEST_TIMEOUT.min + 0.5 })).toThrow(/OPTIONS_INVALID/)
  })

  it("the settings follow Jelly's rules for a declared setting", () => {
    expect(settingsProblems(jelly.contributes.settings)).toEqual([])
  })

  it("access declares Jelly's own words, and the parser takes each value and refuses others", () => {
    const access = jelly.contributes.settings.find((setting) => setting.key === "access")!
    expect(access.choices).toEqual(ACCESS_CHOICES)
    for (const { value } of settingChoices(access) ?? []) expect<string>(loadOptions({ access: value }).access).toBe(value)
    expect(settingValueIssue(access, "write")).not.toBeNull()
    expect(() => loadOptions({ access: "write" })).toThrow(/OPTIONS_INVALID/)
  })
})

describe("docs/jelly.md", () => {
  it("follows the plugin authors' standard", () => {
    expect(docProblems(ROOT)).toEqual([])
  })
})
