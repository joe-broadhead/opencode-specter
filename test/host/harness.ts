// An embedded OpenCode host from the public @opencode/sdk, with no listener and no private host source, as in
// opencode-github's host tests. The plugin is loaded the way a user loads it: a config `plugins` entry that points at
// this package (its built dist/) with options. A probe plugin lends its context to the tests. Specter is the loopback
// fake behind the fetch router, and any other request fails the host's close().
//
// Host version: the SDK in devDependencies (2.4.1), the one tested release.
import { ROOT } from "./isolate.js"
import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import type { OpenCodeClient } from "@opencode/client"
import { Plugin } from "@opencode/plugin"
import { PLUGIN_ID, SERVER_NAME } from "../../src/constants.js"
import { type FakeOptions, startFakeSpecter } from "./fake-specter.js"
import { routeFetch } from "./route-fetch.js"

import { simulateTaggedRelease } from "../../src/release.js"
import { SpecterRpc, type Status } from "../../src/rpc.js"

const REPO = realpathSync(fileURLToPath(new URL("../../", import.meta.url)))
const SDK = join(REPO, "node_modules", "@opencode", "sdk")
const manifest = JSON.parse(readFileSync(join(SDK, "package.json"), "utf8")) as { version: string; exports: { ".": { import: string } } }
/** The OpenCode release under test: the version of the SDK that runs the host. */
export const SDK_VERSION = manifest.version

if (!existsSync(join(REPO, "dist", "index.js"))) throw new Error("dist/ is missing. Run npm run build first.")

export type Rule = { action: string; resource: string; effect: "allow" | "ask" | "deny" }

/** The SDK's client surface; its own declarations import packages that ship no types. */
export type Client = Omit<OpenCodeClient, "plugin"> & {
  readonly sessions: OpenCodeClient["session"]
  readonly plugin: OpenCodeClient["plugin"]
  readonly close: () => Promise<void>
}

export const router = routeFetch()

/** Removes the temp root and restores fetch; call once after every host in the file has closed. */
export function cleanup() {
  if (router.stale.length > 0) console.warn(`requests from closed hosts, blocked: ${[...new Set(router.stale)].join(", ")}`)
  router.restore()
  rmSync(ROOT, { recursive: true, force: true })
}

const probes = new Map<string, Plugin.Context>()
const probe = Plugin.define({
  id: "specter.host-test.probe",
  setup: (ctx) => void probes.set(ctx.location.directory, ctx),
})

export interface HostInput {
  /** Plugin options, as a user writes them in opencode.json. */
  readonly options?: Record<string, unknown>
  /** Extra user config, such as permissions, agents or mcp. Receives the fake's origin. */
  readonly config?: (origin: string) => Record<string, unknown>
  /** The version the host reports to plugins; defaults to the SDK's. */
  readonly version?: string
  /** How the fake Specter behaves. */
  readonly fake?: FakeOptions
}

let hosts = 0

export async function startHost(input: HostInput = {}) {
  // This harness loads the package as a local path, which is not a tagged release. Simulate one so the existing
  // handlers still run against the loopback fake. Production does not set this.
  simulateTaggedRelease(true)
  const base = join(ROOT, `host-${++hosts}`)
  const work = join(base, "work")
  mkdirSync(work, { recursive: true })
  const fake = startFakeSpecter(input.fake)
  router.target = fake.origin
  const blockedBefore = router.blocked.length
  const config = {
    plugins: [{ package: REPO, options: input.options ?? {} }],
    // Keep the built-in local providers from probing their default ports.
    providers: { lmstudio: { settings: { baseURL: "" } }, ollama: { settings: { baseURL: "" } }, vllm: { settings: { baseURL: "" } } },
    ...input.config?.(fake.origin),
  }
  const { OpenCode } = (await import(pathToFileURL(join(SDK, manifest.exports["."].import)).href)) as typeof import("@opencode/sdk")
  const client = (await OpenCode.create({
    plugins: [probe],
    // An embedded host reports "unknown" unless told, and the plugin's host check refuses that.
    app: { version: input.version ?? SDK_VERSION },
    config: { content: JSON.stringify(config), directory: join(base, "config"), project: false, claude: false },
    database: { path: join(base, "opencode.db") },
    models: { fetch: false },
    fs: { filewatcher: false },
    log: { level: "error" },
  })) as Client
  const location = { directory: work }
  const host = {
    client,
    location,
    fake,
    probe: () => {
      const ctx = probes.get(work)
      if (!ctx) throw new Error("the probe plugin has not loaded")
      return ctx
    },
    async close() {
      await client.close()
      router.target = undefined
      router.retired.add(fake.origin)
      await fake.close()
      // OpenCode probes a remote server's OAuth metadata (`/.well-known/…`) itself; any other request off the machine
      // is the failure.
      const blocked = router.blocked.slice(blockedBefore).filter((url) => !/\/\.well-known\//.test(url))
      if (blocked.length > 0) throw new Error(`the host tried to leave the machine: ${[...new Set(blocked)].join(", ")}`)
    },
  }
  try {
    await until("the Specter plugin has settled", async () => (await pluginState(host)) !== undefined && probes.has(work), 60_000)
  } catch (error) {
    await host.close().catch(() => undefined)
    throw error
  }
  return host
}

export type Host = Awaited<ReturnType<typeof startHost>>

export async function until<T>(what: string, check: () => Promise<T | false | undefined>, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await check()
    if (value) return value
    if (Date.now() > deadline) throw new Error(`timed out waiting until ${what}`)
    await Bun.sleep(50)
  }
}

export async function pluginState(host: Host) {
  const { data } = await host.client.plugin.list({ location: host.location })
  return data.find((plugin) => plugin.id === PLUGIN_ID)?.state
}

export async function specterServer(host: Host) {
  const { data } = await host.client.mcp.list({ location: host.location })
  return data.find((server) => server.name === SERVER_NAME)
}

export const agentRules = async (host: Host) =>
  new Map((await host.client.agent.list({ location: host.location })).data.map((agent) => [agent.id as string, agent.permissions as Rule[]]))

/** A session in the host's project, whose agent the host's rules are asserted against. */
export const session = async (host: Host, agent = "build") => (await host.client.sessions.create({ agent, location: host.location })).id

/** The status RPC, called through the probe plugin's context, as opencode-github's host tests call theirs. */
export const status = (host: Host) => host.probe().rpc(SpecterRpc).status({}) as Promise<Status>

