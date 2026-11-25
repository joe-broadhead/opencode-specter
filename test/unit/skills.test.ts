import { readFileSync } from "node:fs"
import { describe, expect, test } from "vitest"
import { SKILL_IDS, parseSkill, skillPath } from "../../src/skills.js"

describe("the plugin's skills", () => {
  test("each file parses, and its name is its folder", () => {
    for (const id of SKILL_IDS) {
      const parsed = parseSkill(id, readFileSync(skillPath(id), "utf8"))
      expect(parsed.name).toBe(id)
      expect(parsed.content.length).toBeGreaterThan(0)
    }
  })

  test("each description is within the 300-character budget", () => {
    for (const id of SKILL_IDS) {
      const parsed = parseSkill(id, readFileSync(skillPath(id), "utf8"))
      expect(parsed.description.length, `${id}: ${parsed.description.length}`).toBeLessThanOrEqual(300)
    }
  })

  test("a malformed skill is refused, not guessed at", () => {
    expect(() => parseSkill("specter", "no frontmatter")).toThrow(/no frontmatter/)
    expect(() => parseSkill("specter", "---\nname: other\ndescription: x\n---\nBody\n")).toThrow(/needs exactly/)
    expect(() => parseSkill("specter", "---\nname: specter\ndescription: x\nextra: y\n---\nBody\n")).toThrow(/needs exactly/)
  })
})
