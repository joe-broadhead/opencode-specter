// The packed tarball: what a person installs is the release tag's package, so the pack must carry the built server entry,
// the skills and the icons, and importing its server entry must give the plugin definition. Run with Bun after `npm run
// build`.
import { afterAll, describe, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const root = new URL("../../", import.meta.url).pathname
const scratch = mkdtempSync(join(root, ".pack-test-"))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** Runs one command and returns its output, failing the test on a non-zero exit. */
function run(command: string[]) {
  const answer = Bun.spawnSync(command, { cwd: root, stdout: "pipe", stderr: "pipe" })
  if (answer.exitCode !== 0) throw new Error(`${command.join(" ")} failed: ${answer.stderr.toString()}`)
  return answer.stdout.toString()
}

describe("the packed plugin", () => {
  test("carries the server entry, the skills and the icons, and imports as Plugin.define({ id: specter })", async () => {
    const packs = join(scratch, "packs")
    mkdirSync(packs, { recursive: true })
    run(["npm", "pack", "--ignore-scripts", "--pack-destination", packs])
    const tarballs = [...new Bun.Glob("*.tgz").scanSync(packs)]
    expect(tarballs).toHaveLength(1)
    const unpacked = join(scratch, "unpacked")
    mkdirSync(unpacked, { recursive: true })
    run(["tar", "-xzf", join(packs, tarballs[0]!), "-C", unpacked])
    const dir = join(unpacked, "package")
    const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string; version: string; exports: Record<string, string>; dependencies?: unknown }
    expect(manifest.name).toBe("@we-the-rebel-alliance/specter-plugin")
    expect(manifest.exports["./server"]).toBe("./dist/index.js")
    expect(manifest.dependencies).toBeUndefined()
    for (const file of ["dist/index.js", "skills/specter/SKILL.md", "skills/specter-write/SKILL.md", "assets/icon.svg", "README.md", "LICENSE", "NOTICE"]) {
      expect(existsSync(join(dir, file)), file).toBe(true)
    }
    for (const absent of ["src", "test", "scripts", "fixtures", "node_modules"]) expect(existsSync(join(dir, absent)), absent).toBe(false)

    // The bundle's only imports are the host's and Node's built-ins; everything else is bundled.
    const bundle = readFileSync(join(dir, "dist/index.js"), "utf8")
    expect(bundle).not.toContain("@we-the-rebel-alliance/plugin-contract/bin")
    const bare = [...bundle.matchAll(/from\s*["']([^"']+)["']/g)].map((match) => match[1]!).filter((specifier) => !specifier.startsWith("node:") && !specifier.startsWith("."))
    expect(bare.every((specifier) => specifier === "@opencode/plugin" || specifier.startsWith("@opencode/plugin/"))).toBe(true)

    // Import the built server entry the way OpenCode resolves `./server`; its manifest read is relative to the package.
    const loaded = (await import(pathToFileURL(join(dir, "dist/index.js")).href)) as { default?: { id?: string; setup?: unknown } }
    expect(loaded.default?.id).toBe("specter")
    expect(typeof loaded.default?.setup).toBe("function")
  }, 120_000)
})
