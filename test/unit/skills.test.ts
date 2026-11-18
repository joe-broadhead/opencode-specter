import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseSkill, SKILL_IDS } from "../../src/skills.js"
import { OWN_TOOL_CLASSES } from "../../src/tools.js"

const text = (id: string) => readFileSync(new URL(`../../skills/${id}/SKILL.md`, import.meta.url), "utf8")

describe("skills", () => {
  it("are the main skill and its -write skill", () => {
    expect([...SKILL_IDS]).toEqual(["specter", "specter-write"])
  })

  for (const id of SKILL_IDS) {
    it(`${id} has exactly a name and a one-line description, and opens with the family's /connect line`, () => {
      const skill = parseSkill(id, text(id))
      expect(skill.name).toBe(id)
      expect(skill.description.length).toBeGreaterThan(40)
      expect(skill.content.split("\n")[0]).toMatch(/^If Specter's tools are absent, run `\/connect` .*, or on Jelly call jelly_connection_request\.$/)
    })

    it(`names only tools this plugin has`, () => {
      // The Slice 9 rule, kept from the start: a skill names a tool only if it exists. Specter's own MCP tools are
      // not named until a live capture classifies them, so every name here is one of the plugin's own.
      const named = parseSkill(id, text(id)).content.match(/\bspecter_[a-z][a-z0-9_]*/g) ?? []
      expect(named.length).toBeGreaterThan(0)
      for (const name of named) expect(Object.keys(OWN_TOOL_CLASSES), name).toContain(name.replace(/^specter_/, ""))
    })
  }

  it("refuses a skill with an unknown frontmatter key", () => {
    expect(() => parseSkill("specter", "---\nname: specter\ndescription: x\nextra: y\n---\nbody")).toThrow(/^SKILLS_INVALID: /)
  })
})
