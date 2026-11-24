// Pack, install and load the published shape, after opencode-metaview's pack test. The tarball holds exactly the files
// whitelist and installs with lifecycle scripts disabled. Installed alone, it loads in each stock OpenCode release it
// is tested on (TESTED_HOSTS), which provides @opencode/plugin, OpenTUI and Solid itself; next to those packages, both
// entry points also import under Bun. OPENCODE_BIN_2_4_1 names a stock binary; otherwise the release is installed with
// npm, once per run. Every temp folder is a git repository under
// the system's /tmp, never under TMPDIR or HOME, so OpenCode's upward search for `.opencode` folders never reaches the
// agents of whoever runs the test. Each stock host runs offline: anything it tries off the machine goes to a closed
// port. PACK_TARBALL names a tarball that was already packed, such as the one a release publishes, to test it instead.
import { afterAll, describe, expect, test } from "bun:test"
import { spawn, spawnSync } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs"
import { createServer } from "node:net"
import { arch, platform } from "node:os"
import { basename, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { DISPLAY_NAME, KEY_INTEGRATION_ID, MCP_URL, PLUGIN_ID, SERVER_NAME, SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { defaultRules, type Rule } from "../../src/permissions.js"
import { SKILL_IDS } from "../../src/skills.js"
import { TOOLS_RPC_ID, methodNames } from "../../src/tools-rpc.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string
  version: string
  files: string[]
  exports: Record<string, string | { default: string }>
  devDependencies: Record<string, string>
  dependencies?: unknown
  peerDependencies?: unknown
}
// Outside the repository, so nothing resolves from the repository's own node_modules.
const work = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "specter-pack-")))
// A repository root, where OpenCode's search for `.opencode` folders and project config stops.
run("git", ["init", "--quiet", work], root)
// Removing the installed packages and binaries can take longer than the default hook timeout.
afterAll(() => rmSync(work, { recursive: true, force: true }), { timeout: 120_000 })

/** The host's ID for a remote MCP server's integration, derived from its name and URL. */
const integrationID = (name: string, url: string) => `mcp_${createHash("sha1").update(`${name}\0${url}`).digest("hex").slice(0, 16)}`

const MAX_FILES = 30
const MAX_PACKED_BYTES = 150 * 1024
// The two self-contained entry bundles, and nothing else, in dist/.
const DIST = ["dist/index.js", "dist/tui.js"]
// Modules the host serves to plugins at runtime. Everything else must be inlined in the bundle.
const SERVER_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/]
const TUI_HOST_MODULES = [/^node:/, /^@opencode\/plugin(?:\/|$)/, /^@opentui\//, /^solid-js(?:\/|$)/]
// The host packages OpenCode 2.4.1 ships; the versions come from devDependencies.
const HOST_PACKAGES = ["@opencode/plugin", "@opentui/core", "@opentui/solid", "solid-js"]
// OpenCode's own agents.
const BUILT_IN_AGENTS = ["build", "general", "explore", "compaction", "title", "summary", "plan"]
// Anything a stock host tries on the network goes to a closed port, except loopback.
const OFFLINE = {
  HTTP_PROXY: "http://127.0.0.1:9",
  HTTPS_PROXY: "http://127.0.0.1:9",
  http_proxy: "http://127.0.0.1:9",
  https_proxy: "http://127.0.0.1:9",
  NO_PROXY: "127.0.0.1,localhost",
  no_proxy: "127.0.0.1,localhost",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  OPENCODE_DISABLE_AUTOUPDATE: "true",
  OPENCODE_DISABLE_FREE_MODELS: "true",
}

type Packed = { filename: string; size: number; entryCount: number; files: { path: string }[] }

let packed: Packed | undefined
function pack(): Packed {
  if (packed) return packed
  const given = process.env.PACK_TARBALL
  if (given) {
    const tarball = resolve(given)
    copyFileSync(tarball, join(work, basename(tarball)))
    const files = run("tar", ["-tzf", tarball], root).trim().split("\n").filter((path) => !path.endsWith("/")).map((path) => ({ path: path.replace(/^package\//, "") }))
    packed = { filename: basename(tarball), size: statSync(tarball).size, entryCount: files.length, files }
    return packed
  }
  // Build first, explicitly: the package has no prepare or prepack hook, and a stale dist/ must never be packed.
  run("node", [join(root, "scripts", "check.mjs"), "build"], root)
  packed = (JSON.parse(run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", work], root)) as Packed[])[0]!
  return packed
}

/** An empty project with its own package.json, so npm never walks up to another one. */
function project(name: string): string {
  const dir = join(work, name)
  mkdirSync(dir)
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: `specter-pack-${name}`, private: true, type: "module" }))
  return dir
}

const installs = new Map<string, string>()
/** The tarball installed with scripts disabled, alone or next to the host packages. */
function install(withHostPackages: boolean): string {
  const name = withHostPackages ? "with-host-packages" : "alone"
  const existing = installs.get(name)
  if (existing) return existing
  const dir = project(name)
  const hosts = withHostPackages ? HOST_PACKAGES.map((item) => `${item}@${pkg.devDependencies[item]}`) : []
  run("npm", ["install", join(work, pack().filename), ...hosts, "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  installs.set(name, dir)
  return dir
}

const installedPackage = (withHostPackages: boolean) => join(install(withHostPackages), "node_modules", ...pkg.name.split("/"))

/** The packed plugin as a release install is: a git repo with the version's tag, dist committed and no dev scripts. */
function releaseRepo(): { spec: string; dir: string } {
  const dir = project("release-repo")
  run("tar", ["-xzf", join(work, pack().filename), "--strip-components=1", "-C", dir], dir)
  const release = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Record<string, unknown>
  delete release.devDependencies
  delete release.scripts
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(release, null, 2)}\n`)
  run("git", ["init", "--quiet"], dir)
  run("git", ["add", "-A"], dir)
  // dist/ is git-ignored on master; a release commit carries it.
  run("git", ["add", "-f", "dist"], dir)
  run("git", ["-c", "user.name=pack test", "-c", "user.email=pack@example.invalid", "commit", "-qm", "release"], dir)
  run("git", ["tag", `v${pkg.version}`], dir)
  return { spec: `git+file://${dir}#v${pkg.version}`, dir }
}

/** A home, OpenCode's test home, XDG folders and a temp folder, all inside `base`. */
function isolated(base: string) {
  const home = join(base, "home")
  const env = {
    HOME: home,
    OPENCODE_TEST_HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    XDG_DATA_HOME: join(home, ".local", "share"),
    XDG_CACHE_HOME: join(home, ".cache"),
    XDG_STATE_HOME: join(home, ".local", "state"),
    TMPDIR: join(base, "tmp"),
  }
  for (const dir of Object.values(env)) mkdirSync(dir, { recursive: true })
  return env
}

const target = (entry: string | { default: string }) => (typeof entry === "string" ? entry : entry.default).replace(/^\.\//, "")

describe("package tarball", () => {
  test("lists exactly the files whitelist, under the size and file limits", () => {
    const { files, entryCount, size } = pack()
    const paths = files.map((file) => file.path).sort()
    expect(paths).toEqual(["package.json", ...pkg.files.flatMap((entry) => whitelisted(entry))].sort())
    expect(entryCount).toBeLessThan(MAX_FILES)
    expect(size).toBeLessThanOrEqual(MAX_PACKED_BYTES)
    expect(paths.filter((path) => path.includes("node_modules/") || /\.(?:tsx|jsx)$/.test(path))).toEqual([])
    for (const entry of Object.values(pkg.exports)) expect(paths).toContain(target(entry))
    expect(paths.filter((path) => path.endsWith(".d.ts"))).toEqual([])
  }, 120_000)

  test("declares no runtime or peer dependency, and writes the MCP endpoint once in the server bundle", () => {
    expect(pkg.dependencies).toBeUndefined()
    expect(pkg.peerDependencies).toBeUndefined()
    // Written once, so a test can point the built plugin at a fake.
    const server = readFileSync(join(installedPackage(true), "dist", "index.js"), "utf8")
    expect(server.split(MCP_URL).length - 1).toBe(1)
  }, 300_000)

  test("installs with scripts disabled and loads both entry points under Bun, next to the host packages", () => {
    const consumer = install(true)
    const probe = join(consumer, "probe.mjs")
    writeFileSync(probe, [
      "const out = {}",
      `for (const [part, specifier] of [["server", ${JSON.stringify(pkg.name)}], ["tui", ${JSON.stringify(`${pkg.name}/tui`)}]]) {`,
      "  const plugin = (await import(specifier)).default",
      "  out[part] = { id: plugin?.id, setup: typeof plugin?.setup }",
      "}",
      "console.log(JSON.stringify(out))",
    ].join("\n"))
    const output = run(process.execPath, [probe], consumer, { PATH: process.env.PATH, ...isolated(join(work, "bun-probe")) })
    expect(JSON.parse(output.trim().split("\n").at(-1)!)).toEqual({
      server: { id: PLUGIN_ID, setup: "function" },
      tui: { id: `${PLUGIN_ID}.tui`, setup: "function" },
    })
  }, 300_000)

  // OpenCode reloads a plugin in place and reuses the module records it holds for unchanged paths, so an entry that
  // imported a sibling module could get an older cached copy of it. Each entry must stand alone.
  test("dist holds only the two entry bundles, and they import no sibling module", () => {
    const dist = join(installedPackage(true), "dist")
    expect(tree(relative(root, dist), dist).sort()).toEqual(["index.js", "tui.js"])
    for (const file of ["index.js", "tui.js"]) expect(relativeImports(readFileSync(join(dist, file), "utf8"))).toEqual([])
  }, 300_000)

  // The TUI bundle is not minified, so its comments ship: none may name the plan behind the code.
  test("dist carries no plan references: no TODO, plan file, plan step or decision number", () => {
    const dist = join(installedPackage(true), "dist")
    // Decision numbers such as B2 or D3 are looked for in comments only: a minified name can look the same.
    const comments = (text: string) => (text.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g) ?? []).join("\n")
    for (const file of ["index.js", "tui.js"]) {
      const text = readFileSync(join(dist, file), "utf8")
      const found = [...(text.match(/\bTODO\b|SPEC\.md|\bSlice \d+/g) ?? []), ...(comments(text).match(/\b[BD]\d+\b/g) ?? [])]
      expect({ file, found }).toEqual({ file, found: [] })
    }
  }, 300_000)

  test("dist imports only modules the host provides", () => {
    const dist = join(installedPackage(true), "dist")
    expect(foreign(join(dist, "index.js"), SERVER_HOST_MODULES)).toEqual([])
    expect(foreign(join(dist, "tui.js"), TUI_HOST_MODULES)).toEqual([])
  }, 300_000)
})

describe.each(TESTED_HOSTS)("installed alone, in stock OpenCode %s", (version) => {
  test("is active, registers specter and its key sign-in, adds the default rules, answers status and describes its tools RPC", async () => {
    const installed = installedPackage(false)
    const host = await serve(version, installed)
    try {
      const plugin = await host.until("the plugin finishes loading", async () => {
        const { data } = await host.api<{ data: { id: string; state: { status: string } }[] }>("GET", "/api/plugin")
        const found = data.find((item) => item.id === PLUGIN_ID)
        return found && found.state.status !== "loading" ? found : undefined
      })
      expect(plugin.state).toEqual({ status: "active" })

      // An untagged local install is a dev build: the gate never registers Specter's MCP server, and says why.
      const status = await host.until("the gate reports NOT_RELEASED", async () => {
        const { output } = await host.api<{ output: Record<string, unknown> }>("POST", `/api/rpc/${PLUGIN_ID}/status`, { input: {} })
        const plugins = await host.api<{ data: unknown[] }>("GET", "/api/plugin")
        console.log("ENTRY", JSON.stringify(plugins.data.find((item) => (item as { id?: string }).id === PLUGIN_ID)))
        const problems = Array.isArray(output.problems) ? output.problems : []
        return problems.some((problem) => String(problem).startsWith("NOT_RELEASED")) ? output : undefined
      })
      expect(status).toMatchObject({
        version: pkg.version,
        key: { connected: false, check: "unchecked" },
        access: "all",
        unguardedAgents: ["reviewer"],
        host: { version, range: SUPPORTED_HOST, tested: true },
      })
      expect(status).not.toHaveProperty("server")
      expect(status).not.toHaveProperty("shadowedSkills")
      const { data: servers } = await host.api<{ data: { name: string }[] }>("GET", "/api/mcp")
      expect(servers.map((item) => item.name)).not.toContain(SERVER_NAME)

      // The team key's own integration, in /connect under Specter's name, with one key method.
      const key = await host.until("/connect lists the key integration", async () => {
        const { data } = await host.api<{ data: { id: string; name: string; methods?: { type: string }[] }[] }>("GET", "/api/integration")
        return data.find((item) => item.id === KEY_INTEGRATION_ID)
      })
      expect(key.name).toBe(DISPLAY_NAME)
      expect(key.methods?.map((method) => method.type)).toEqual(["key"])

      const build = await host.until("the build agent has the default rules", async () => {
        const { data } = await host.api<{ data: { id: string; permissions: Rule[] }[] }>("GET", "/api/agent")
        const permissions = data.find((agent) => agent.id === "build")?.permissions
        return permissions?.some((rule) => rule.action === `${SERVER_NAME}_*`) ? permissions : undefined
      })
      const rules = defaultRules()
      const base = build.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(base).toBeGreaterThanOrEqual(0)
      expect(build.slice(base + 1, base + 1 + rules.length)).toEqual(rules)

      // The tools RPC answers with no model: its id, and exactly the methods the plugin offers (its own four REST tools
      // and the source's two, until a live capture classifies Specter's MCP tools).
      const { output: described } = await host.api<{ output: { id: string; methods: { name: string }[] } }>("POST", `/api/rpc/${TOOLS_RPC_ID}/describe`, { input: {} })
      expect(described.id).toBe(TOOLS_RPC_ID)
      expect(described.methods.map((method) => method.name).sort()).toEqual(methodNames())

      // The project's agents are exactly OpenCode's own and the one its config defines: nothing came from a folder
      // above the temp root.
      const { data: agents } = await host.api<{ data: { id: string }[] }>("GET", "/api/agent")
      expect(agents.map((agent) => agent.id).filter((id) => !BUILT_IN_AGENTS.includes(id))).toEqual(["reviewer"])
      const { data: skills } = await host.api<{ data: { id: string; path: string }[] }>("GET", "/api/skill")
      const own = skills.filter((skill) => skill.id.startsWith(SERVER_NAME)).map(({ id, path }) => ({ id, path }))
      expect(own.sort((a, b) => a.id.localeCompare(b.id))).toEqual([...SKILL_IDS].sort().map((id) => ({ id, path: join(installed, "skills", id, "SKILL.md") })))
    } catch (error) {
      throw new Error(`${(error as Error).message}\n--- opencode ${version} log ---\n${host.log().slice(-3000)}`)
    } finally {
      await host.close()
    }
  }, 600_000)

  test("an untagged copy in a tag-named directory is not a release", async () => {
    const dir = join(work, "@v0.0.0")
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "specter-pack-tagname", private: true }))
    run("npm", ["install", join(work, pack().filename), "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
    const installed = join(dir, "node_modules", ...pkg.name.split("/"))
    expect(installed).toContain("@v0.0.0")
    const host = await serve(version, installed, "-tagname")
    try {
      await host.until("the plugin finishes loading", async () => {
        const { data } = await host.api<{ data: { id: string; state: { status: string } }[] }>("GET", "/api/plugin")
        const found = data.find((item) => item.id === PLUGIN_ID)
        return found && found.state.status !== "loading" ? found : undefined
      })
      const status = await host.until("the gate reports NOT_RELEASED", async () => {
        const { output } = await host.api<{ output: Record<string, unknown> }>("POST", `/api/rpc/${PLUGIN_ID}/status`, { input: {} })
        const problems = Array.isArray(output.problems) ? output.problems : []
        return problems.some((problem) => String(problem).startsWith("NOT_RELEASED")) ? output : undefined
      })
      expect(status).not.toHaveProperty("server")
      const { data: servers } = await host.api<{ data: { name: string }[] }>("GET", "/api/mcp")
      expect(servers.map((item) => item.name)).not.toContain(SERVER_NAME)
    } finally {
      await host.close()
    }
  }, 600_000)
})

describe("a real release install on stock OpenCode 2.4.1", () => {
  test("a tagged package spec registers Specter's server, so it is not gated", async () => {
    const release = releaseRepo()
    const host = await serve("2.4.1", release.spec, "-release")
    try {
      await host.until("the plugin finishes loading", async () => {
        const { data } = await host.api<{ data: { id: string; state: { status: string } }[] }>("GET", "/api/plugin")
        const found = data.find((item) => item.id === PLUGIN_ID)
        return found && found.state.status !== "loading" ? found : undefined
      })
      const server = await host.until("the specter server is registered", async () => {
        const { data } = await host.api<{ data: { name: string; integrationID?: string }[] }>("GET", "/api/mcp")
        return data.find((item) => item.name === SERVER_NAME)
      })
      // The ID OpenCode keys the sign-in by: the same name and URL as a sign-in made before the plugin was installed.
      expect(server.integrationID).toBe(integrationID(SERVER_NAME, MCP_URL))
      const { output } = await host.api<{ output: Record<string, unknown> }>("POST", `/api/rpc/${PLUGIN_ID}/status`, { input: {} })
      expect(output).toMatchObject({ version: pkg.version, server: { type: "plugin", url: MCP_URL } })
      expect(JSON.stringify(output.problems ?? [])).not.toContain("NOT_RELEASED")
    } finally {
      await host.close()
    }
  }, 600_000)
})

/** OPENCODE_BIN_<version>, or the unmodified npm release with its platform binary, installed with scripts disabled. */
const binaries = new Map<string, string>()
function stockBinary(version: string): string {
  const given = process.env[`OPENCODE_BIN_${version.replaceAll(".", "_")}`]
  if (given) return given
  const cached = binaries.get(version)
  if (cached) return cached
  const binary = `@opencode/cli-${platform()}-${arch()}`
  const dir = project(`opencode-${version}`)
  // Only this platform's binary: each one is a few hundred megabytes.
  run("npm", ["install", `@opencode/cli@${version}`, `${binary}@${version}`, "--omit=optional", "--ignore-scripts", "--no-audit", "--no-fund", "--prefer-offline"], dir)
  const path = join(dir, "node_modules", binary, "bin", "opencode")
  binaries.set(version, path)
  return path
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done))
  const { port } = server.address() as { port: number }
  await new Promise((done) => server.close(done))
  return port
}

/**
 * `opencode serve` on its own port and password, in an environment that holds only its temp root and is offline, with
 * a project that loads the installed package and defines one agent only in user config, `reviewer`.
 */
async function serve(version: string, plugins: string | readonly string[], label = "") {
  const binary = stockBinary(version)
  const base = join(work, `stock-${version}${label}`)
  const directory = join(base, "project")
  // Keep the built-in local providers from probing their default ports.
  const providers = { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } }
  mkdirSync(directory, { recursive: true })
  const agents = { reviewer: { description: "Reviews changes", mode: "subagent" } }
  writeFileSync(join(directory, "opencode.json"), JSON.stringify({ plugins: typeof plugins === "string" ? [plugins] : [...plugins], agents, providers }))
  const password = randomUUID()
  const env = { ...isolated(base), ...OFFLINE, PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", OPENCODE_PASSWORD: password }

  expect(run(binary, ["--version"], directory, env).trim()).toBe(`opencode v${version}`)
  // OpenCode resolves every global path from this environment; none may leave the temp root.
  const paths = run(binary, ["debug", "paths"], directory, env).trim().split("\n").map((line) => line.trim().split(/\s+/))
  expect(paths.length).toBeGreaterThan(5)
  expect(paths.filter(([, path]) => !path?.startsWith(base + sep))).toEqual([])

  const port = await freePort()
  let log = ""
  const server = spawn(binary, ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] })
  server.stdout.on("data", (chunk) => void (log += chunk))
  server.stderr.on("data", (chunk) => void (log += chunk))
  const exited = new Promise((done) => server.once("exit", done))

  const authorization = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  const api = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const url = new URL(path, `http://127.0.0.1:${port}`)
    url.searchParams.set("location[directory]", directory)
    const response = await fetch(url, { method, headers: { authorization, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) })
    const text = await response.text()
    if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${text.slice(0, 500)}`)
    return JSON.parse(text) as T
  }
  /** Polls until `read` returns a value. The server answers before plugins finish loading, more slowly when busy. */
  const until = async <T>(what: string, read: () => Promise<T | false | undefined>, ms = 180_000): Promise<T> => {
    for (const deadline = Date.now() + ms; ; await Bun.sleep(500)) {
      const value = await read().catch((error: unknown) => (Date.now() > deadline ? Promise.reject(error) : undefined))
      if (value) return value
      if (server.exitCode !== null) throw new Error(`opencode ${version} exited before ${what}`)
      if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    }
  }
  const close = async () => {
    if (server.exitCode !== null || server.signalCode !== null) return
    server.kill("SIGTERM")
    const timer = setTimeout(() => server.kill("SIGKILL"), 10_000)
    await exited
    clearTimeout(timer)
  }
  return { api, until, close, log: () => log }
}

// The files a `files` entry should put in the tarball. dist/ must hold exactly the two bundles, so stale or foreign
// build output fails the comparison, and so does a missing whitelisted file.
function whitelisted(entry: string): string[] {
  if (entry === "dist") return DIST
  const path = join(root, entry)
  if (!existsSync(path)) return [`${entry} (missing)`]
  return statSync(path).isDirectory() ? tree(entry) : [entry]
}

/** Every file under `dir`, as paths relative to `base` (the repository root by default). */
function tree(dir: string, base = root): string[] {
  return readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
    .filter((item) => item.isFile() && item.name !== ".DS_Store")
    .map((item) => relative(base, join(item.parentPath, item.name)).split(sep).join("/"))
}

/** Every module specifier in a file: static imports and re-exports, dynamic `import()` and `require()`. */
const specifiers = (source: string) =>
  [...source.matchAll(/(?:^|[\s;}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?["']([^"']+)["']|\b(?:import|require)\s*\(\s*["'`]?([^"'`)]*)["'`]?\s*\)/g)].map((match) => (match[1] ?? match[2])!)

/** Relative imports, and every dynamic `import()` or `require()` call: a self-contained bundle has none. */
const relativeImports = (source: string) => [
  ...specifiers(source).filter((specifier) => specifier.startsWith(".")),
  ...[...source.matchAll(/(?<![\w$.])(?:import|require)\s*\(/g)].map((match) => match[0]),
]

/** The bare specifiers of one bundle that the allowed list does not cover. */
const foreign = (file: string, allowed: RegExp[]) =>
  [...new Set(specifiers(readFileSync(file, "utf8")).filter((specifier) => !allowed.some((pattern) => pattern.test(specifier))))].sort()

function run(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = { ...process.env, npm_config_update_notifier: "false" }): string {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", env })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed (${result.status}):\n${result.stderr}\n${result.stdout}`)
  return result.stdout
}
