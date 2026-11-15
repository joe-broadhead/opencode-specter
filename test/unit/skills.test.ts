import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { parseSkill, SKILL_IDS } from "../../src/skills.js"

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

    it(`${id} names no Specter tool, because none is classified yet`, () => {
      // TODO(Slice 9): once tools exist, check that a skill names only tools that exist.
      expect(parseSkill(id, text(id)).content.match(/\bspecter_[a-z][a-z0-9_]*/g) ?? []).toEqual([])
    })
  }

  it("refuses a skill with an unknown frontmatter key", () => {
    expect(() => parseSkill("specter", "---\nname: specter\ndescription: x\nextra: y\n---\nbody")).toThrow(/^SKILLS_INVALID: /)
  })
})
