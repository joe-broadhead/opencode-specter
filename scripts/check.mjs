// The one local entry point: `npm run check` runs every stage in order and stops at the first failure.
// `node scripts/check.mjs <stage>...` runs only the named stages, in the order given.
//
// The stages are the plugin's own checks plus `plugin-kit check`, which runs conformance (T0 and T1 on every tested
// host), the generated-doc drift, forbidden patterns, the doc file set and the bundled-kit check. `bundle` runs before
// `kit` and `host`: both load the built bundle.
import { spawnSync } from "node:child_process"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const env = { ...process.env, PATH: `${join(root, "node_modules", ".bin")}${delimiter}${process.env.PATH ?? ""}` }

const stages = {
  typecheck: () => run("tsc", ["--noEmit", "-p", "tsconfig.json"]),
  bundle: () => run("node", ["scripts/build.mjs"]),
  unit: () => run("vitest", ["run", "test/unit"]),
  conformance: () => run("vitest", ["run", "test/conformance"]),
  host: () => run("bun", ["test", "./test/host"]),
  pack: () => run("bun", ["test", "./test/pack"]),
  kit: () => run("plugin-kit", ["check"]),
}

const selected = process.argv.slice(2)
const unknown = selected.filter((name) => !Object.hasOwn(stages, name))
if (unknown.length) {
  console.error(`check: unknown stage ${unknown.map((name) => `"${name}"`).join(", ")}. Stages: ${Object.keys(stages).join(", ")}.`)
  process.exit(2)
}
const order = selected.length ? selected : Object.keys(stages)
for (const name of order) {
  console.log(`\n[check] ${name}`)
  const code = stages[name]()
  if (code !== 0) {
    console.error(`\n[check] FAILED at stage "${name}". Fix it, then rerun: node scripts/check.mjs ${name}`)
    process.exit(code || 1)
  }
}
console.log(`\n[check] passed: ${order.join(", ")}`)

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, env, stdio: "inherit" })
  if (result.error?.code === "ENOENT") {
    console.error(`${command} was not found. Run npm ci first; install Bun from https://bun.sh if bun is missing.`)
    return 127
  }
  if (result.error) throw result.error
  return result.status ?? 1
}
