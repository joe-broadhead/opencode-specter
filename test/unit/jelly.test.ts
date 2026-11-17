import { describe, expect, it } from "vitest"
import { CODES, KEY_INTEGRATION_ID, KEY_METHOD_LABEL, SERVER_NAME } from "../../src/constants.js"
import { CREDIT_PRICE_PUBLIC, MCP_DAILY_CALLS } from "../../src/costs.js"
import { loadOptions, REQUEST_TIMEOUT } from "../../src/options.js"
import { defaultRules } from "../../src/permissions.js"
import { SKILL_IDS } from "../../src/skills.js"
import { MCP_TOOLS } from "../../src/specter-tools.js"
import { OWN_TOOL_CLASSES } from "../../src/tools.js"
import { TOOL_PREFIX } from "../../src/tools.js"
import { type Declaration, type DeclaredTool, declarationProblems, docProblems, effectFromRules, lineProblems, readPackage } from "../support/jelly-kit.js"
import { ACCESS_CHOICES, type PluginSetting, settingChoices, settingsProblems, settingValueIssue } from "../support/jelly-settings.js"

/**
 * The `jelly` section of package.json, which Jelly reads without loading the plugin. The shared kit checks it against
 * Jelly's plugin authors' standard; the tests below add what only Specter declares. Jelly's agents have no base
 * "allow everything" rule, so the plugin's own default rules never reach them; Jelly writes each declared `ask` or
 * `deny` as that tool's default instead.
 */

const ROOT = new URL("../../", import.meta.url)
const manifest = readPackage(ROOT)
const jelly = manifest.jelly as Declaration & { cost?: string } & { rpc: unknown[]; views: unknown[]; contributes: Record<string, unknown[]> & { settings: PluginSetting[] }; tools: DeclaredTool[] }

/** Every classified tool, Specter's MCP tools and the plugin's own, by permission, with whether it is read-only. */
function knownTools(): Map<string, boolean> {
  const known = new Map<string, boolean>()
  for (const [name, toolClass] of Object.entries(MCP_TOOLS)) known.set(`${TOOL_PREFIX}${name}`, toolClass === "read")
  for (const [name, toolClass] of Object.entries(OWN_TOOL_CLASSES)) known.set(`${TOOL_PREFIX}${name}`, toolClass === "read")
  return known
}

describe("the jelly declaration", () => {
  it("follows the plugin authors' standard, with the effects the plugin's own default rules give", () => {
    // Specter's own MCP tools are not declared until a live capture classifies them; the plugin's own tools and the
    // source contract's two methods are, and the standard is met exactly.
    expect(declarationProblems(ROOT, { effectOf: effectFromRules(defaultRules()) })).toEqual([])
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

  // Not one group: Jelly reads a group's sign-ins as alternatives, one connected being enough, and these two are not.
  // The MCP sign-in is each person's and serves Specter's own tools; the team key serves only the plugin's own tools,
  // and Specter says MCP tokens and API keys are not interchangeable. The key is optional until an own tool needs it.
  it("declares two separate sign-ins: the MCP account, and the optional team key with its help page and codes", () => {
    expect(jelly.signIns).toEqual([
      { id: "account", label: "Specter account", server: SERVER_NAME },
      {
        id: "specter",
        label: KEY_METHOD_LABEL,
        integration: KEY_INTEGRATION_ID,
        required: false,
        help: { url: "https://app.tryspecter.com/settings/api-console", label: "Copy the team API key from Specter's API Console" },
        needed: ["AUTH_REQUIRED", "KEY_REJECTED"],
      },
    ])
    // The codes that ask for the key are the plugin's own, raised when no key is connected or Specter refuses it.
    for (const code of ["AUTH_REQUIRED", "KEY_REJECTED"] as const) expect(CODES).toContain(code)
  })

  it("states the cost honestly: credits from one pool, no public price, the MCP allowance, a free key check", () => {
    expect(lineProblems("cost", jelly.cost, 300)).toEqual([])
    expect(jelly.cost).toMatch(/credits from the team's one pool/)
    expect(jelly.cost).toMatch(/publishes no price per credit/)
    expect(jelly.cost).toContain(`${MCP_DAILY_CALLS} MCP tool calls a day`)
    expect(jelly.cost).toMatch(/checking the key is free/)
    expect(CREDIT_PRICE_PUBLIC).toBe(false)
  })

  it("declares only the keys opencode-github declares, a cost line, and no RPC methods, views or other contributions", () => {
    expect(Object.keys(jelly)).toEqual(["title", "summary", "icon", "cost", "tools", "skills", "rpc", "views", "signIns", "contributes"])
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
