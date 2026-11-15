import { describe, expect, it } from "vitest"
import { ACCESS_VALUES } from "../../src/constants.js"
import { changeEffect, defaultRules, effectOf, insertDefaults, registerPermissionDefaults, type Rule, toolsOf, unguardedAgents } from "../../src/permissions.js"

const BASE: Rule = { action: "*", resource: "*", effect: "allow" }

describe("default rules (D1, D2)", () => {
  it("give a change the access effect: allow, ask, deny", () => {
    expect(ACCESS_VALUES.map(changeEffect)).toEqual(["allow", "ask", "deny"])
  })

  it("treat a tool the plugin has not classified like a change, at every access", () => {
    for (const access of ACCESS_VALUES) {
      const rules = [BASE, ...defaultRules(access)]
      expect(effectOf(rules, "specter_never_seen_tool"), access).toBe(changeEffect(access))
    }
  })

  it("start with the broad specter_* rule, so the narrow class rules after it win", () => {
    for (const access of ACCESS_VALUES) expect(defaultRules(access)[0]).toEqual({ action: "specter_*", resource: "*", effect: changeEffect(access) })
  })

  it("allow every read, and give every spend and write the change effect (vacuous until the table is filled)", () => {
    for (const access of ACCESS_VALUES) {
      const rules = [BASE, ...defaultRules(access)]
      for (const name of toolsOf("read")) expect(effectOf(rules, `specter_${name}`), `${access} ${name}`).toBe("allow")
      for (const name of [...toolsOf("spend"), ...toolsOf("write")]) expect(effectOf(rules, `specter_${name}`), `${access} ${name}`).toBe(changeEffect(access))
    }
  })

  it("leave other plugins' tools alone", () => {
    expect(defaultRules("read-only").every((rule) => rule.action.startsWith("specter_"))).toBe(true)
  })
})

describe("insertion", () => {
  const rules = defaultRules("ask-changes")

  it("goes right after the agent's base * * allow", () => {
    const before: Rule[] = [{ action: "bash", resource: "*", effect: "ask" }, BASE, { action: "edit", resource: "*", effect: "deny" }]
    const after = insertDefaults(before, rules)
    expect(after.slice(0, 2)).toEqual(before.slice(0, 2))
    expect(after.slice(2, 2 + rules.length)).toEqual(rules)
    expect(after.at(-1)).toEqual(before.at(-1))
  })

  it("is not repeated, and skips an agent without a base allow", () => {
    const once = insertDefaults([BASE], rules)
    expect(insertDefaults(once, rules)).toEqual(once)
    const strict: Rule[] = [{ action: "*", resource: "*", effect: "ask" }]
    expect(insertDefaults(strict, rules)).toEqual(strict)
  })

  it("names the agents that miss the block and would run a new tool unasked", () => {
    const agents = [
      { id: "build", permissions: insertDefaults([BASE], defaultRules("all")) },
      { id: "mine", permissions: [BASE] },
      { id: "careful", permissions: [BASE, { action: "specter_*", resource: "*", effect: "deny" } as Rule] },
    ]
    expect(unguardedAgents(agents, "all")).toEqual(["mine"])
  })

  it("never throws from the transform; a failure is reported", async () => {
    const reports: (string | undefined)[] = []
    const ctx = {
      agent: {
        transform: async (callback: (editor: unknown) => void) => {
          callback({ list: () => { throw new Error("broken host") }, update: () => undefined })
          return { dispose: async () => undefined }
        },
      },
    }
    await registerPermissionDefaults(ctx as never, "all", (problem) => reports.push(problem))
    expect(reports[0]).toMatch(/^RULES_NOT_ADDED: .* Next step: Restart OpenCode\.$/)
  })
})
