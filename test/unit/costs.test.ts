// The cost facts from Specter's public docs: each with a source, the docs page equal to the table, and nothing in them
// that decides a permission.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { COST_SOURCES, costText, MCP_CREDIT_USE, MCP_DAILY_CALLS, MCP_TOOL_COSTS, REST_COST_RULES } from "../../src/costs.js"
import { statusRows } from "../../src/rpc.js"
import { MCP_TOOLS } from "../../src/specter-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DOC = readFileSync(join(ROOT, "docs/costs.md"), "utf8")

describe("costs", () => {
  it("cites only Specter's own public pages, over HTTPS", () => {
    for (const url of Object.values(COST_SOURCES)) expect(url).toMatch(/^https:\/\/(?:api\.tryspecter\.com\/|intercom\.help\/specter-labs\/)/)
    for (const rule of REST_COST_RULES) expect(Object.keys(COST_SOURCES)).toContain(rule.source)
  })

  it("lists Specter's 30 published MCP tools, each with a cost", () => {
    expect(Object.keys(MCP_TOOL_COSTS)).toHaveLength(30)
    for (const [name, cost] of Object.entries(MCP_TOOL_COSTS)) {
      expect(name).toMatch(/^[a-z][a-z_]*$/)
      expect("free" in cost || (Number.isInteger(cost.credits) && cost.credits > 0), name).toBe(true)
    }
  })

  it("docs/costs.md shows the same table and every source", () => {
    for (const [name, cost] of Object.entries(MCP_TOOL_COSTS)) expect(DOC).toContain(`| \`${name}\` | ${costText(cost)} |`)
    for (const rule of REST_COST_RULES) expect(DOC).toContain(`| ${rule.calls} | ${rule.cost} | [`)
    for (const url of Object.values(COST_SOURCES)) expect(DOC).toContain(url)
    expect(DOC).toMatch(/not yet confirmed against live responses/)
    expect(DOC).toContain(`${MCP_DAILY_CALLS} tool calls a day`)
  })

  it("status says how MCP calls use credits, and that it is unconfirmed", () => {
    expect(MCP_CREDIT_USE).toMatch(/not yet confirmed live/)
    const status = { version: "0", state: "connected", key: { connected: false, check: "unchecked" }, access: "all", tools: { visible: 0, unknown: [] }, unguardedAgents: [], host: { version: "2.2.3", range: "", tested: true }, nextStep: "" } as const
    expect(statusRows(status).find((row) => row.label === "MCP credit use")?.value).toBe(MCP_CREDIT_USE)
  })

  it("decides no permission: the classified table stays empty until a live capture", () => {
    expect(MCP_TOOLS).toEqual({})
  })
})
