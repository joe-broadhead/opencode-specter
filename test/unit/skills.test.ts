import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "@opencode/plugin"
import { describe, expect, test } from "vitest"
import { readSkills, registerSkills } from "../../src/skills.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

/** A temporary `skills/` directory holding one file per entry. */
function fixture(files: Readonly<Record<string, string>>): string {
  const directory = mkdtempSync(join(tmpdir(), "specter-skills-"))
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name), { recursive: true })
    writeFileSync(join(directory, name, "SKILL.md"), text)
  }
  return directory
}

/** Runs `check` against a temporary skills tree, then removes it. */
function withFixture<T>(files: Readonly<Record<string, string>>, check: (directory: string) => T): T {
  const directory = fixture(files)
  try {
    return check(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

describe("the plugin's skills", () => {
  test("the package ships two checked skills, with their YAML names, descriptions and bodies", () => {
    const skills = readSkills()
    expect(skills.map((skill) => skill.id)).toEqual(["specter", "specter-write"])
    for (const skill of skills) {
      expect(skill.name).toBe(skill.id)
      expect(skill.description.trim().length).toBeGreaterThan(0)
      expect(skill.content.trim().length).toBeGreaterThan(0)
      expect(skill.content.startsWith("---")).toBe(false)
      expect(skill.path).toBe(join(ROOT, "skills", skill.id, "SKILL.md"))
    }
    const write = skills.find((skill) => skill.id === "specter-write")
    expect(write?.description.startsWith("Before any Specter call")).toBe(true)
    expect(write?.content.startsWith("# Spending credits")).toBe(true)
  })

  test.each([
    ["folded", ">", "first line second line\n"],
    ["literal", "|", "first line\nsecond line\n"],
    ["folded-strip", ">-", "first line second line"],
    ["literal-strip", "|-", "first line\nsecond line"],
    ["folded-keep", ">+", "first line second line\n\n"],
    ["literal-keep", "|+", "first line\nsecond line\n\n"],
  ])("YAML block scalar %s registers its real text, not the marker", (name, marker, expected) => {
    const gap = marker.endsWith("+") ? "\n\n" : ""
    withFixture({ [name]: `---\nname: ${name}\ndescription: ${marker}\n  first line\n  second line\n${gap}---\n\n# Body\n` }, (directory) => {
      const skill = readSkills(directory)[0]
      expect(skill?.description, name).toBe(expected)
    })
  })

  test("an empty description or a bare block marker is refused, not registered", () => {
    withFixture({ empty: "---\nname: empty\ndescription: >\n---\n\n# Body\n" }, (directory) => {
      expect(() => readSkills(directory)).toThrow(/has no frontmatter description/)
    })
    for (const marker of [">", "|", ">-", "|-"]) {
      withFixture({ marker: `---\nname: marker\ndescription: '${marker}'\n---\n\n# Body\n` }, (directory) => {
        expect(() => readSkills(directory), marker).toThrow(/only a block marker/)
      })
    }
  })

  test("invalid YAML is refused with the YAML error, including an unquoted description with ': '", () => {
    withFixture({ broken: "---\nname: broken\ndescription: Specter deal data: resolve a company\n---\n\n# Body\n" }, (directory) => {
      expect(() => readSkills(directory)).toThrow(/has frontmatter that is not valid YAML/)
    })
    withFixture({ broken: "---\nname: broken\ndescription: [unclosed\n---\n\n# Body\n" }, (directory) => {
      expect(() => readSkills(directory)).toThrow(/has frontmatter that is not valid YAML/)
    })
  })

  test("a skill file must have the frontmatter shape the plugin registers", () => {
    const cases: readonly [string, Readonly<Record<string, string>>, RegExp][] = [
      ["no frontmatter", { broken: "# Broken\n" }, /SCHEMA_VIOLATION: skills\/broken\/SKILL.md has no frontmatter\. Next step: /],
      ["no name", { broken: "---\ndescription: A description.\n---\n\n# Body\n" }, /has no frontmatter name/],
      ["another name", { broken: "---\nname: other\ndescription: A description.\n---\n\n# Body\n" }, /names "other", not its directory "broken"/],
      ["no description", { broken: "---\nname: broken\n---\n\n# Body\n" }, /has no frontmatter description/],
      ["empty content", { broken: "---\nname: broken\ndescription: A description.\n---\n\n" }, /has no content below its frontmatter/],
    ]
    for (const [name, files, expected] of cases) {
      withFixture(files, (directory) => {
        expect(() => readSkills(directory), name).toThrow(expected)
      })
    }
    withFixture({}, (directory) => {
      mkdirSync(join(directory, "empty"), { recursive: true })
      expect(() => readSkills(directory)).toThrow(/skills\/empty\/SKILL.md is missing/)
    })
    withFixture({}, (directory) => {
      expect(() => readSkills(directory)).toThrow(/skills\/ holds no <name>\/SKILL\.md/)
    })
  })

  test("registerSkills adds every checked skill and returns a disposer", async () => {
    const added: { id: string; name: string; description?: string; path: string; content: string }[] = []
    let disposed = false
    const context = {
      skill: {
        async transform(callback: (editor: { add: (skill: (typeof added)[number]) => void }) => void) {
          callback({ add: (skill) => added.push(skill) })
          return {
            async dispose() {
              disposed = true
            },
          }
        },
      },
    } as unknown as Plugin.Context
    const registration = await registerSkills(context)
    expect(added.map((skill) => skill.id)).toEqual(["specter", "specter-write"])
    for (const skill of added) {
      expect(skill.name).toBe(skill.id)
      expect(skill.description?.trim().length).toBeGreaterThan(0)
      expect(skill.path).toBe(join(ROOT, "skills", skill.id, "SKILL.md"))
      expect(skill.content.trim().length).toBeGreaterThan(0)
    }
    await registration.dispose()
    expect(disposed).toBe(true)
  })
})
