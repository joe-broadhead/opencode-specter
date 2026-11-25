import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { parseSkill, skillIds, skillPath } from "../../src/skills.js"

describe("the plugin's skills", () => {
  test("every skills/ directory is a skill, and its name is its folder", async () => {
    const ids = await skillIds()
    expect(ids).toEqual(["specter", "specter-write"])
    for (const id of ids) {
      const parsed = parseSkill(id, readFileSync(skillPath(id), "utf8"))
      expect(parsed.name).toBe(id)
      expect(parsed.description.length).toBeGreaterThan(0)
      expect(parsed.content.length).toBeGreaterThan(0)
      expect(skillPath(id).endsWith(`skills/${id}/SKILL.md`)).toBe(true)
    }
  })

  test("each description is within the 300-character budget", async () => {
    for (const id of await skillIds()) {
      const parsed = parseSkill(id, readFileSync(skillPath(id), "utf8"))
      expect(parsed.description.length, `${id}: ${parsed.description.length}`).toBeLessThanOrEqual(300)
    }
  })

  test("a malformed skill is refused, not guessed at", () => {
    expect(() => parseSkill("specter", "no frontmatter")).toThrow(/no frontmatter/)
    expect(() => parseSkill("specter", "---\nname: other\ndescription: x\n---\nBody\n")).toThrow(/needs exactly/)
    expect(() => parseSkill("specter", "---\nname: specter\ndescription: x\nextra: y\n---\nBody\n")).toThrow(/needs exactly/)
    expect(() => parseSkill("specter", "---\nname: specter\ndescription: x\n---\n")).toThrow(/has no content/)
  })
})
