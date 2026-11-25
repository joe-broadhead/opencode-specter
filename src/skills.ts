// The plugin's hand-written skills. Every `skills/<id>/SKILL.md` in the package is read once at setup and registered
// through OpenCode's public skill editor. A missing or malformed skill stops setup: the plugin's model-facing text is part
// of it, not an optional extra.
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Skill } from "@opencode/plugin"

type ParsedSkill = { readonly name: string; readonly description: string; readonly content: string }

/** The skills directory of the installed package; `dist/index.js` and `src/skills.ts` both sit one level below it. */
const SKILLS = new URL("../skills/", import.meta.url)

/** Every skill directory in the package, sorted. A directory without a SKILL.md is refused when it is read. */
export async function skillIds(): Promise<readonly string[]> {
  const entries = await readdir(fileURLToPath(SKILLS), { withFileTypes: true }).catch(() => {
    throw invalid("The package's skills/ directory is missing or unreadable.")
  })
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
  const description = unquote(id, fields.get("description"))
  if (fields.size !== 2 || name !== id) throw invalid(`skills/${id}/SKILL.md needs exactly a name equal to "${id}" and a description.`)
  if (!description) throw invalid(`skills/${id}/SKILL.md has an empty description; use one plain line.`)
  if (description === ">" || description === "|" || description.startsWith("> ") || description.startsWith("| ")) {
    throw invalid(`skills/${id}/SKILL.md has a block-scalar description (${JSON.stringify(description.slice(0, 2))}), which this parser does not read; use one plain line.`)
  }
  const content = match[2]!.trim()
  if (content === "") throw invalid(`skills/${id}/SKILL.md has no content.`)
  return { name, description, content }
}

/** A one-line description may be bare or wrapped in matching quotes, which YAML frontmatter allows. */
function unquote(id: string, value: string | undefined): string | undefined {
  if (value === undefined || (value[0] !== '"' && value[0] !== "'")) return value
  if (value.length < 2 || !value.endsWith(value[0]!)) throw invalid(`skills/${id}/SKILL.md has an unclosed quoted description.`)
  return value.slice(1, -1)
}

function invalid(reason: string): Error {
  return new Error(`UNAVAILABLE: ${reason} Next step: Reinstall the plugin.`)
}

export function skillPath(id: string): string {
  return fileURLToPath(new URL(`${id}/SKILL.md`, SKILLS))
}

/** Reads every skill directory and returns the host's Skill.Info values; setup registers them through ctx.skill. */
export async function loadSkills(): Promise<readonly Skill.Info[]> {
  const ids = await skillIds()
  return Promise.all(
    ids.map(async (id) => {
      const path = skillPath(id)
      const text = await readFile(path, "utf8").catch(() => {
        throw invalid(`skills/${id}/SKILL.md is missing or unreadable.`)
      })
      const parsed = parseSkill(id, text)
      return {
        id: Skill.ID.make(id),
        name: Skill.Name.make(parsed.name),
        description: parsed.description,
        // The host brands absolute paths; this one comes from the package location.
        path: path as Skill.Info["path"],
        content: parsed.content,
      }
    }),
  )
}
