// The server part: registers Specter's hosted MCP server, the `specter` namespace with its two tool families, the
// default permission rules, the plugin's own key integration, status, the tools RPC for scripts and the skills, in
// opencode-github's setup order. Everything goes through public OpenCode plugin APIs; nothing is stored. Every
// transform is synchronous and never throws: a failure is kept and shown by status.
import { type Mcp, Plugin } from "@opencode/plugin"
import { registerToolsRpc } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { request } from "./api/request.js"
import { errorText, PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { keyReader, registerKeyIntegration } from "./credential.js"
import { checkHost } from "./host-version.js"
import { keyChecker } from "./key-check.js"
import { loadOptions } from "./options.js"
import { registerPermissionDefaults } from "./permissions.js"
import { ownSpecs } from "./read-tools.js"
import { reasonOf } from "./redact.js"
import { configureReleaseGate, vendorCallsAllowed } from "./release.js"
import type { ServerSource } from "./rpc.js"
import { registerSkills, SKILL_IDS, skillPath } from "./skills.js"
import { assertAction, eventsMethod, probeMethod, registerSource, type SourceDeps } from "./source/index.js"
import { registerStatus } from "./status.js"
import { OWN_TOOL_CLASSES, registerTools } from "./tools.js"
import { methodTable, PLUGIN } from "./tools-rpc.js"

/** Internal seam: tests point the server at a loopback fake, without OAuth. */
export interface SpecterSeam {
  readonly endpoint: string
  readonly oauth?: false
}

type RemoteConfig = Extract<Mcp.ServerConfig, { type: "remote" }>
type Registration = { dispose(): Promise<void> }

/**
 * No protocol, codemode, timeout, headers or `oauth` setting: the host defaults apply, and OpenCode runs the server's
 * OAuth sign-in from Specter's published metadata (scope `openid`, PKCE, a client ID metadata document or dynamic
 * registration). The host tests complete that sign-in against a fake serving the metadata verbatim.
 */
export const serverConfig = (seam: SpecterSeam): RemoteConfig => ({
  type: "remote",
  url: seam.endpoint,
  ...(seam.oauth === false ? { oauth: false } : {}),
})

/** Origin and path only, so a token in a query string never reaches status. */
export function displayUrl(url: string) {
  try {
    const parsed = new URL(url)
    return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`
  } catch {
    return "an invalid URL"
  }
}

/** A conflicting server's address for status: another origin shows only its origin, because its path can hold a secret. */
export function conflictUrl(url: string, expected: string) {
  try {
    const parsed = new URL(url)
    if (parsed.origin === new URL(expected).origin) return displayUrl(url)
    return parsed.pathname.replace(/\/+$/, "") === "" ? parsed.origin : `${parsed.origin}/…`
  } catch {
    return "an invalid URL"
  }
}

/**
 * Registers `specter`, or adopts the user's own `mcp.servers.specter` unchanged when it points at Specter's URL: user
 * config is applied first, and a later `set` would replace it. Of the user's entry only its `type`, its `url` and
 * whether `oauth` is false are read, never its `headers`, which may hold a credential. Any other URL, or a local
 * command, is a conflict, and nothing is added. Synchronous and never throws.
 */
export function registerServer(
  mcp: Pick<Plugin.Context["mcp"], "transform">,
  config: RemoteConfig,
  record: (source: ServerSource | undefined, problem?: string) => void,
) {
  return mcp.transform((editor) => {
    try {
      const existing = editor.get(SERVER_NAME)
      const expected = displayUrl(config.url)
      if (!existing) {
        editor.set(SERVER_NAME, config)
        return record({ type: "plugin", url: expected })
      }
      if (existing.type !== "remote") return record({ type: "conflict", url: "a local command", expected })
      const url = displayUrl(existing.url)
      const signIn = existing.oauth === false ? "own" : "oauth"
      record(url === expected ? { type: "adopted", url, signIn } : { type: "conflict", url: conflictUrl(existing.url, config.url), expected })
    } catch (error) {
      record(undefined, errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}

const warn = (message: string) => console.warn(message)

export function createSpecterPlugin(seam: SpecterSeam) {
  return Plugin.define({
    id: PLUGIN_ID,
    async setup(ctx) {
      const options = loadOptions(ctx.options)
      const hostWarning = checkHost(ctx.app.version, options.allowUntestedHost)
      const registrations: Registration[] = []
      const keep = <R extends Registration>(registration: R): R => {
        registrations.push(registration)
        return registration
      }
      let disposed = false
      const cleanup = async () => {
        disposed = true
        for (const registration of registrations.splice(0).reverse()) await registration.dispose()
      }
      // The host does not list the plugin itself during setup; the gate reads its report once the entry is there.
      configureReleaseGate(() => ctx.plugin.list)
      // Transforms replay on every rebuild, so each one overwrites its own entry rather than appending.
      const problems = new Map<string, string>()
      const report = (area: string) => (problem: string | undefined) => void (problem ? problems.set(area, problem) : problems.delete(area))
      let source: ServerSource | undefined
      // The plugin's own server, or the user's adopted one; a server at another URL is not Specter's.
      const owned = () => source?.type === "plugin" || source?.type === "adopted"
      try {
        keep(await registerPermissionDefaults(ctx, options.access, report("rules")))
        const readKey = keyReader(ctx.integration, warn)
        const keys = keyChecker()
        // The plugin's own tools and the source contract's methods read Specter's REST API with the team key, which is
        // read at call time and only ever sent to the REST base.
        const specs = ownSpecs({
          key: async () => (await readKey())?.key,
          timeoutMs: options.requestTimeoutMs,
          assert: (call, action, resources) => assertAction(ctx.permission, action, call, resources),
        })
        const sourceDeps: SourceDeps = {
          access: async (call) => {
            const key = await readKey()
            if (key === undefined) return undefined
            return {
              key: key.key,
              read: (input) => request(input, { key: key.key, fetch, timeoutMs: options.requestTimeoutMs, signal: call.signal }),
            }
          },
          permission: ctx.permission,
        }
        // The namespace and the server's tool count; the MCP registration comes next, so ownership is read lazily.
        const tools = keep(await registerTools(ctx, { access: options.access, specs, owned, report: report("tools") }))
        keep(await registerSource(ctx, sourceDeps))
        // Registering the MCP server is a setup-time decision, but the answer is not available during setup: the host
        // adds the plugin's own entry to `ctx.plugin.list` only after setup returns. So watch for it, then register;
        // a source install never registers the server (fail closed) and the tools answer NOT_RELEASED.
        void (async () => {
          for (let attempt = 0; attempt < 25 && !disposed; attempt++) {
            if (await vendorCallsAllowed()) {
              if (disposed) return
              try {
                const registered = await registerServer(ctx.mcp, serverConfig(seam), (next, problem) => {
                  source = next
                  report("server")(problem)
                })
                if (disposed) await registered.dispose().catch(() => undefined)
                else keep(registered)
              } catch (error) {
                report("server")(
                  errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} MCP server could not be registered (${reasonOf(error)}).`, "Restart OpenCode."),
                )
              }
              return
            }
            await new Promise((resolve) => setTimeout(resolve, 200))
          }
          if (!disposed) {
            report("server")(
              errorText(
                "NOT_RELEASED",
                "This copy is not a released install, so Specter was not called.",
                "Wait for a release tag. Do not install this repository from source if you need to call Specter.",
              ),
            )
          }
        })()
        keep(await registerKeyIntegration(ctx, report("integration")))
        keep(
          await registerStatus(ctx, {
            access: options.access,
            hostVersion: ctx.app.version,
            ...(hostWarning ? { hostWarning } : {}),
            source: () => source,
            tools: tools.tools,
            key: async () => {
              const key = await readKey()
              // The check asks Specter's free credit balance once per key, and again once its answer is ten minutes
              // old, in the background; status reads only that key's standing answer, so it never waits on Specter
              // and never shows one key's answer for another.
              if (key) void keys.check(key.key)
              return key
            },
            keyCheck: (key) => keys.last(key),
            skills: SKILL_IDS.map((id) => ({ id, path: skillPath(id) })),
            problems: () => [...problems.values()],
            needsKey: Object.keys(OWN_TOOL_CLASSES).length > 0,
          }),
        )
        // Scripts call every classified tool with no model, as a session and its agent: a call that spends credits or
        // changes data needs a prior allow rule for its action.
        const methods = methodTable(specs, [eventsMethod(sourceDeps), probeMethod(sourceDeps)])
        const stopTools = await registerToolsRpc(ctx as never, { plugin: PLUGIN, methods, mcp: { server: SERVER_NAME, managed: owned } })
        keep({ dispose: stopTools })
        keep(await registerSkills(ctx))
      } catch (error) {
        await cleanup().catch(() => undefined)
        throw error
      }
      return cleanup
    },
  })
}
