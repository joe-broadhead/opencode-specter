// The plugin's hand-written skills. Every `skills/<id>/SKILL.md` in the package is read once at setup and registered
// through OpenCode's public skill editor. A missing or malformed skill stops setup: the plugin's model-facing text is part
// of it, not an optional extra.
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { type Plugin, Skill } from "@opencode/plugin"

type ParsedSkill = { readonly name: string; readonly description: string; readonly content: string }

/** The skills directory of the installed package; `dist/index.js` and `src/skills.ts` both sit one level below it. */
const SKILLS = new URL("../skills/", import.meta.url)

/** Every skill directory in the package, sorted. A directory without a SKILL.md is refused when it is read. */
export async function skillIds(): Promise<readonly string[]> {
  let entries
  try {
    entries = await readdir(fileURLToPath(SKILLS), { withFileTypes: true })
  } catch {
    throw invalid("The package's skills/ directory is missing or unreadable.")
  }
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
}

/** Parses the frontmatter strictly: exactly `name` (equal to the folder) and a one-line `description`. */
export function parseSkill(id: string, text: string): ParsedSkill {
  const source = text.replace(/\r\n/g, "\n")
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(source)
  if (!match) throw invalid(`skills/${id}/SKILL.md has no frontmatter block.`)
  const fields = new Map<string, string>()
  for (const line of match[1]!.split("\n")) {
    const field = /^([a-z]+):\s*(.*)$/.exec(line)
    if (!field || fields.has(field[1]!)) throw invalid(`skills/${id}/SKILL.md has an invalid frontmatter line: ${line.slice(0, 80)}.`)
    fields.set(field[1]!, field[2]!.trim())
  }
  const name = fields.get("name")
  const description = fields.get("description")
  if (fields.size !== 2 || name !== id || !description) throw invalid(`skills/${id}/SKILL.md needs exactly a name equal to "${id}" and a description.`)
  const content = match[2]!.trim()
  if (content === "") throw invalid(`skills/${id}/SKILL.md has no content.`)
  return { name, description, content }
}

function invalid(reason: string): Error {
  return new Error(`UNAVAILABLE: ${reason} Next step: Reinstall the plugin.`)
}

export function skillPath(id: string): string {
  return fileURLToPath(new URL(`${id}/SKILL.md`, SKILLS))
}

type SkillDomain = Pick<Plugin.Context["skill"], "transform">

/** Reads every skill directory and registers each SKILL.md through the host's skill editor. */
export async function registerSkills(skill: SkillDomain): Promise<{ dispose(): Promise<void> }> {
  const ids = await skillIds()
  const skills = await Promise.all(
    ids.map(async (id) => {
      const path = skillPath(id)
      const text = await readFile(path, "utf8").catch(() => {
        throw invalid(`skills/${id}/SKILL.md is missing or unreadable.`)
      })
      return { id, path, ...parseSkill(id, text) }
    }),
  )
  return skill.transform((editor) => {
    for (const skill of skills) {
      editor.add({
        id: Skill.ID.make(skill.id),
        name: Skill.Name.make(skill.name),
        description: skill.description,
        // The host brands absolute paths; this one comes from the package location.
        path: skill.path as Skill.Info["path"],
        content: skill.content,
      })
    }
  })
}
