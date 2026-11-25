// Builds dist/index.js: one self-contained ESM bundle, so an in-place plugin update can never mix a new entry with a
// stale sibling module the host still holds. The host provides @opencode/plugin and Node's built-ins; everything else the
// plugin imports is bundled. NOTICE carries the licence of every bundled package, and the build fails when it no longer
// matches what esbuild bundled (`--notice` rewrites it).
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "esbuild"

const root = fileURLToPath(new URL("../", import.meta.url))
const dist = join(root, "dist")
const HOST_PROVIDED = ["@opencode/plugin", "@opencode/plugin/*"]
const allowed = (path) => path.startsWith("node:") || HOST_PROVIDED.some((name) => (name.endsWith("/*") ? path.startsWith(name.slice(0, -1)) : path === name))

const result = await build({
  absWorkingDir: root,
  entryPoints: [join(root, "src/index.ts")],
  outfile: join(dist, "index.js"),
  bundle: true,
  splitting: false,
  minify: true,
  format: "esm",
  platform: "node",
  target: "es2022",
  external: HOST_PROVIDED,
  legalComments: "inline",
  metafile: true,
  logLevel: "warning",
})

const unexpected = Object.values(result.metafile.outputs).flatMap((output) =>
  output.imports.filter((item) => item.external && !allowed(item.path)).map((item) => item.path),
)
if (unexpected.length > 0) throw new Error(`dist/index.js imports modules that are neither bundled nor provided by the host: ${unexpected.join(", ")}`)

/** The licence of every package under node_modules that esbuild bundled, sorted by name. */
function noticeOf(metafile) {
  const inputs = Object.keys(metafile.inputs)
  const packages = new Set(inputs.flatMap((input) => /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(input)?.[1] ?? []))
  const sections = [...packages].sort().map((name) => {
    const dir = join(root, "node_modules", name)
    const { version, license } = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    const file = readdirSync(dir).find((entry) => /^(licen[cs]e|copying)(\.|$)/i.test(entry))
    if (!file) throw new Error(`${name} is bundled but ships no licence file`)
    return `## ${name} ${version} (${license})\n\n${readFileSync(join(dir, file), "utf8").trim()}\n`
  })
  return `specter-plugin bundles this third-party code into dist/.\n\n${sections.join("\n")}`
}

const notice = noticeOf(result.metafile)
const path = join(root, "NOTICE")
if (process.argv.includes("--notice")) writeFileSync(path, notice)
else if (!existsSync(path) || readFileSync(path, "utf8") !== notice) {
  throw new Error("NOTICE does not match the bundled packages. Run `node scripts/build.mjs --notice` to rewrite it.")
}

const files = readdirSync(dist, { recursive: true }).map(String).sort()
if (files.join(",") !== "index.js") throw new Error(`dist/ must hold exactly index.js, found: ${files.join(", ")}`)
