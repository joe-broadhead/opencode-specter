// docs/tool-classes.md: the draft classification of Specter's MCP tools from its public per-tool rates. It must cover
// exactly the published tools, follow the drafting rules the page states, say it awaits a live capture, and decide no
// permission: the classified table stays empty, so the default rules treat every Specter MCP tool like a change.
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MCP_TOOL_COSTS } from "../../src/costs.js"
import { defaultRules, effectOf } from "../../src/permissions.js"
import { MCP_TOOLS } from "../../src/specter-tools.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const DOC = readFileSync(join(ROOT, "docs/tool-classes.md"), "utf8")
const ROWS = new Map([...DOC.matchAll(/^\| `([a-z_]+)` \| (read|spend|write) \| /gmu)].map((match) => [match[1]!, match[2]!]))

describe("the draft MCP tool classification", () => {
  it("covers exactly Specter's published tools", () => {
    expect([...ROWS.keys()].sort()).toEqual(Object.keys(MCP_TOOL_COSTS).sort())
  })

  it("follows its drafting rules: a change by name is write, any cost is spend, the rest read", () => {
    for (const [name, cost] of Object.entries(MCP_TOOL_COSTS)) {
      const expected = /^(?:create|update|delete)_/.test(name) ? "write" : "free" in cost && !cost.note ? "read" : "spend"
      expect(ROWS.get(name), name).toBe(expected)
      if (expected === "read") expect(name).toMatch(/^(?:find|get)_/)
    }
  })

  it("says it awaits a live capture, and decides no permission", () => {
    expect(DOC).toMatch(/to be confirmed by a live capture/)
    expect(MCP_TOOLS).toEqual({})
    for (const access of ["all", "ask-changes", "read-only"] as const) {
      const change = access === "all" ? "allow" : access === "ask-changes" ? "ask" : "deny"
      for (const name of ROWS.keys()) expect(effectOf(defaultRules(access), `specter_${name}`), `${access} ${name}`).toBe(change)
    }
  })
})
