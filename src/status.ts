// One status, computed fresh on every call (no locks, caches or caps), behind the /specter-status command and the RPC
// method the TUI view uses. It makes no upstream call: it reads OpenCode's own state, the connected key's presence and
// label (never the key), and the last key check.
import type { Plugin } from "@opencode/plugin"
import { type Access, DISPLAY_NAME, SERVER_NAME, SUPPORTED_HOST, TESTED_HOSTS } from "./constants.js"
import type { SpecterKey } from "./credential.js"
import { SpecterPluginError } from "./errors.js"
import { isTestedHost } from "./host-version.js"
import type { KeyCheck } from "./key-check.js"
import { defaultRules, unguardedAgents } from "./permissions.js"
import { AGENT_STEP, formatStatus, NOTHING_TO_DO, type ServerSource, type SkillPath, SpecterRpc, type Status, STATUS_COMMAND } from "./rpc.js"
import type { ServerTools } from "./tools.js"
import { PLUGIN_VERSION } from "./version.js"

const UNAVAILABLE = new SpecterPluginError("STATUS_UNAVAILABLE", `${DISPLAY_NAME} status is unavailable right now.`, "Try again in a few seconds; if it persists, restart OpenCode.").message

type StatusContext = {
  readonly mcp: Pick<Plugin.Context["mcp"], "list">
  readonly agent: Pick<Plugin.Context["agent"], "list">
  readonly skill: Pick<Plugin.Context["skill"], "list">
}

export type StatusDeps = {
  readonly access: Access
  readonly hostVersion: string
  readonly hostWarning?: string
  readonly source: () => ServerSource | undefined
  readonly tools: () => ServerTools
  readonly key: () => Promise<SpecterKey | undefined>
  /** The last check of the key, never a new request: status makes no upstream call. */
  readonly keyCheck: () => KeyCheck
  readonly skills: readonly SkillPath[]
  readonly problems: () => readonly string[]
  /** Whether any of the plugin's own tools needs the team key. None does until Slice 7. */
  readonly needsKey: boolean
}

export async function computeStatus(ctx: StatusContext, deps: StatusDeps): Promise<Status> {
  const [servers, agents, listed, key] = await Promise.all([
    ctx.mcp.list(),
    ctx.agent.list(),
    ctx.skill.list().then((result) => result.data, () => undefined),
    deps.key().catch(() => undefined),
  ])
  const source = deps.source()
  const server = servers.data.find((item) => item.name === SERVER_NAME)
  const state = stateOf(server?.status.status, source)
  const unguarded = unguardedAgents(agents.data, deps.access)
  const shadowed = shadowedSkills(deps.skills, listed ?? [])
  const problems = deps.problems()
  const check = key ? deps.keyCheck() : "unchecked"
  return {
    version: PLUGIN_VERSION,
    state,
    ...(source ? { server: source } : {}),
    key: { connected: key !== undefined, ...(key?.label ? { label: key.label } : {}), check },
    access: deps.access,
    tools: { visible: deps.tools().visible, unknown: [...deps.tools().unknown] },
    unguardedAgents: unguarded,
    ...(unguarded.length > 0 ? { permissionsBlock: defaultRules(deps.access) } : {}),
    ...(shadowed.length > 0 ? { shadowedSkills: shadowed } : {}),
    ...(problems.length > 0 ? { problems: [...problems] } : {}),
    host: { version: deps.hostVersion, range: SUPPORTED_HOST, tested: isTestedHost(deps.hostVersion) },
    ...(deps.hostWarning ? { hostWarning: deps.hostWarning } : {}),
    nextStep:
      problemStep(problems) ??
      connectionStep(state) ??
      keyStep(key !== undefined, check, deps.needsKey) ??
      (unguarded.length > 0 ? AGENT_STEP : undefined) ??
      skillStep(shadowed) ??
      (deps.hostWarning ? `If ${DISPLAY_NAME} misbehaves, use OpenCode ${TESTED_HOSTS.slice(0, -1).join(", ")} or ${TESTED_HOSTS.at(-1)}, where it is tested.` : undefined) ??
      NOTHING_TO_DO,
  }
}

type ServerState = "connected" | "pending" | "disabled" | "failed" | "needs_auth"

function stateOf(server: ServerState | undefined, source: ServerSource | undefined): Status["state"] {
  if (source?.type === "conflict") return "conflict"
  if (server === undefined) return source === undefined ? "connecting" : "not_configured"
  if (server === "pending") return "connecting"
  return server === "needs_auth" ? "sign_in_required" : server
}

/** The first registration problem's own next step. */
function problemStep(problems: readonly string[]): string | undefined {
  return problems[0]?.split("Next step: ")[1]
}

function connectionStep(state: Status["state"]): string | undefined {
  switch (state) {
    case "connected":
      return undefined
    case "sign_in_required":
      // TODO(Slice 4, B2): the sign-in flow is unverified, and may need an admin step once B2 is answered. Slice 4 may
      // also name the server's OAuth integration "Specter account" in /connect, as opencode-tavily does.
      return `Open /mcps, choose ${SERVER_NAME} and sign in.`
    case "connecting":
      return `${DISPLAY_NAME} is still starting. Check again in a few seconds.`
    case "failed":
      return `OpenCode could not reach ${DISPLAY_NAME}'s MCP server. Check your network connection, then reconnect ${SERVER_NAME} in /mcps.`
    case "disabled":
      return `Turn the ${SERVER_NAME} server back on in /mcps.`
    case "not_configured":
      return `Restart OpenCode. If ${DISPLAY_NAME} is still missing, check that no other plugin removes the MCP server named ${SERVER_NAME}.`
    case "conflict":
      return `Your OpenCode config or another plugin defines its own MCP server named ${SERVER_NAME} at another address, so this plugin left it unchanged. Point it at ${DISPLAY_NAME}'s address, or remove it.`
  }
}

function keyStep(connected: boolean, check: KeyCheck, needsKey: boolean): string | undefined {
  if (connected && check === "rejected") return `Run /connect, choose ${DISPLAY_NAME} and paste a current team API key.`
  if (!connected && needsKey) return `Run /connect, choose ${DISPLAY_NAME} and paste the team API key.`
  return undefined
}

function shadowedSkills(own: readonly SkillPath[], listed: readonly SkillPath[]): SkillPath[] {
  return own.flatMap((skill) => {
    const found = listed.find((item) => item.id === skill.id)
    return found && found.path !== skill.path ? [{ id: skill.id, path: found.path }] : []
  })
}

function skillStep(shadowed: readonly SkillPath[]): string | undefined {
  if (shadowed.length === 0) return undefined
  return `Rename or move ${shadowed.map((skill) => `the "${skill.id}" skill at ${skill.path}`).join(" and ")}, which OpenCode loads instead of the plugin's skill of the same name.`
}

type RegisterContext = StatusContext & {
  readonly command: Pick<Plugin.Context["command"], "transform">
  readonly rpc: Pick<Plugin.Context["rpc"], "register">
  readonly session: Pick<Plugin.Context["session"], "synthetic">
}

export async function registerStatus(ctx: RegisterContext, deps: StatusDeps): Promise<{ dispose(): Promise<void> }> {
  const compute = () => computeStatus(ctx, deps)
  const registrations: Array<{ dispose(): Promise<void> }> = []
  try {
    registrations.push(
      await ctx.command.transform((editor) => {
        editor.add({
          name: STATUS_COMMAND,
          description: `Show whether ${DISPLAY_NAME} is connected and what to do next`,
          execute: async ({ sessionID, delivery }) => {
            const text = await compute().then(formatStatus, () => UNAVAILABLE)
            await ctx.session.synthetic({ sessionID, delivery, text, description: `${DISPLAY_NAME} status`, resume: false })
          },
        })
      }),
    )
    registrations.push(
      await ctx.rpc.register(SpecterRpc, {
        status: async (_input, { error }) => {
          try {
            return await compute()
          } catch {
            return error("unavailable", UNAVAILABLE, { reason: `OpenCode did not report the ${SERVER_NAME} server's state.` })
          }
        },
      }),
    )
  } catch (cause) {
    for (const registration of registrations.splice(0).reverse()) await registration.dispose()
    throw cause
  }
  return {
    async dispose() {
      for (const registration of registrations.splice(0).reverse()) await registration.dispose()
    },
  }
}
