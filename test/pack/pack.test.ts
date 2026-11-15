// Pack and install the published shape, after opencode-linear's pack test: the tarball holds exactly the files
// whitelist, installs with lifecycle scripts disabled, carries two self-contained bundles and no runtime dependency,
// and both entry points import under Bun next to the host packages. Every temp folder is under the system's /tmp,
// never under TMPDIR or HOME. PACK_TARBALL names a tarball that was already packed, such as the one a release
// publishes, to test it instead. TODO(Slice 11): load the tarball in each stock OpenCode release, as linear's does.
import { afterAll, describe, expect, test } from "bun:test"
import { spawnSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { MCP_URL, PLUGIN_ID } from "../../src/constants.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string
  files: string[]
  exports: Record<string, string | { default: string }>
  devDependencies: Record<string, string>
  dependencies?: unknown
  peerDependencies?: unknown
}
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "specter-pack-")))
afterAll(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

const MAX_FILES = 30
const MAX_PACKED_BYTES = 150 * 1024
const DIST = ["dist/index.js", "dist/tui.js"]
const HOST_PACKAGES = ["@opencode/plugin", "@opentui/core", "@opentui/solid", "solid-js"]

function run(command: string, args: string[], cwd: string): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" })
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed:\n${result.stderr}`)
  return result.stdout
}

type Packed = { filename: string; size: number; files: { path: string }[] }
let packed: Packed | undefined
function pack(): Packed {
  if (packed) return packed
  const given = process.env.PACK_TARBALL
  if (given) {
    const tarball = resolve(given)
    copyFileSync(tarball, join(work, basename(tarball)))
    const files = run("tar", ["-tzf", tarball], root).trim().split("\n").filter((path) => !path.endsWith("/")).map((path) => ({ path: path.replace(/^package\//, "") }))
    packed = { filename: basename(tarball), size: statSync(tarball).size, files }
    return packed
  }
  // Build first, explicitly: the package has no prepare or prepack hook, and a stale dist/ must never be packed.
  run("node", [join(root, "scripts", "check.mjs"), "build"], root)
  packed = (JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)) as Packed[])[0]!
  return packed
}

const target = (entry: string | { default: string }) => (typeof entry === "string" ? entry : entry.default).replace(/^\.\//, "")

describe("package tarball", () => {
  test("lists exactly the whitelisted files, under the size and file limits", () => {
    const { files, size } = pack()
    const paths = files.map((file) => file.path).sort()
    expect(paths.filter((path) => path.startsWith("dist/")).sort()).toEqual(DIST)
    expect(paths.length).toBeLessThan(MAX_FILES)
    expect(size).toBeLessThanOrEqual(MAX_PACKED_BYTES)
    for (const entry of Object.values(pkg.exports)) expect(paths).toContain(target(entry))
    expect(paths.filter((path) => path.endsWith(".d.ts") || path.includes("node_modules/") || /\.(?:tsx|jsx|ts)$/.test(path))).toEqual([])
    for (const path of paths) expect(path === "package.json" || pkg.files.some((entry) => path === entry || path.startsWith(`${entry}/`)), path).toBe(true)
  }, 120_000)

  test("declares no runtime or peer dependency, and its bundles import only what the host provides", () => {
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
    pack()
    const bundles = DIST.map((path) => readFileSync(join(root, path), "utf8"))
    for (const text of bundles) {
      const specifiers = [...text.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map((match) => match[1]!)
      expect(specifiers.filter((name) => !/^node:|^@opencode\/plugin(?:\/|$)|^@opentui\/|^solid-js(?:\/|$)/.test(name))).toEqual([])
    }
    // The MCP endpoint is written once in the server bundle, so a test can point the built plugin at a fake.
    expect(bundles[0]!.split(MCP_URL).length - 1).toBe(1)
  }, 120_000)

  test("installs with scripts disabled and loads both entry points under Bun, next to the host packages", () => {
    const dir = join(work, "consumer")
    mkdirSync(dir)
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "specter-pack-consumer", private: true, type: "module" }))
    const hosts = HOST_PACKAGES.map((name) => `${name}@${pkg.devDependencies[name]}`)
    run("npm", ["install", join(work, pack().filename), ...hosts, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
    writeFileSync(
      join(dir, "probe.mjs"),
      [
        "const out = {}",
        `for (const [part, specifier] of [["server", ${JSON.stringify(pkg.name)}], ["tui", ${JSON.stringify(`${pkg.name}/tui`)}]]) {`,
        "  const plugin = (await import(specifier)).default",
        "  out[part] = { id: plugin?.id, setup: typeof plugin?.setup }",
        "}",
        "console.log(JSON.stringify(out))",
      ].join("\n"),
    )
    expect(JSON.parse(run("bun", ["probe.mjs"], dir))).toEqual({ server: { id: PLUGIN_ID, setup: "function" }, tui: { id: `${PLUGIN_ID}.tui`, setup: "function" } })
  }, 300_000)
})
