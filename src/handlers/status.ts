// `status`: the contract's one status answer, from OpenCode's own state. `statusAnswer` assembles the shape, so this
// handler keeps no state of its own: it passes the manifest, the versions, each alias's state, setup's problems, and the
// agents whose rules no longer give every generated rule its effect.
//
// It makes no upstream call: the MCP server states are OpenCode's, and the team key's presence is the integration's.
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { type AccountSignal, type AccountStatus, accountName, accountsOf, accountStatuses, redactReason, STATUS_SCHEMA, statusAnswer } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { EMPTY } from "./schemas.js"
import type { HandlerDeps, ServerView } from "./types.js"

/** Why an alias's server is not usable, as one redacted line. */
function signalOf(name: string, server: ServerView | undefined): AccountSignal {
  if (server === undefined) return { state: "error", reason: `OpenCode does not list the Specter server "${name}"; restart OpenCode.` }
  switch (server.state) {
    case "connected":
      return { state: "ready" }
    case "needs_auth":
      return { state: "needs_sign_in" }
    case "pending":
      return { state: "error", reason: "OpenCode is still connecting to Specter." }
    case "disabled":
      return { state: "error", reason: "The Specter MCP server is disabled in OpenCode." }
    case "failed":
      return { state: "error", reason: server.error ?? "OpenCode could not reach the Specter MCP server." }
  }
}

const line = (text: string): string => redactReason(text)

export function createStatusHandler(deps: HandlerDeps) {
  return {
    description: "Read the plugin's state: its host range, each Specter account alias, and the agents whose rules no longer hold.",
    input: EMPTY,
    output: STATUS_SCHEMA,
    async run(_input: Readonly<Record<string, unknown>>, call: MethodCall) {
      const problems = deps.problems().map(line)
      let servers: readonly ServerView[] = []
      let serverProblem: string | undefined
      try {
        servers = await deps.servers()
      } catch (error) {
        // An unreadable server list is unknown, never empty: every alias says so and the state is error.
        serverProblem = line(`OpenCode did not report its MCP servers: ${error instanceof Error ? error.message : String(error)}`)
        problems.push(serverProblem)
      }
      const plan = accountsOf(deps.manifest, deps.options)
      const accounts: readonly AccountStatus[] = plan.ok
        ? accountStatuses(
            plan.value.accounts,
            Object.fromEntries(
              plan.value.accounts.map((profile) => {
                const name = accountName(deps.manifest.plugin.name, profile.alias)
                return [profile.alias, serverProblem === undefined ? signalOf(name, servers.find((server) => server.name === name)) : { state: "error" as const, reason: serverProblem }]
              }),
            ),
          )
        : []
      if (!plan.ok) problems.push(...plan.problems.map((problem) => line(`OPTIONS_INVALID: ${problem}`)))

      // An unreadable agent list is unknown, never zero: `statusAnswer` adds the failed result as a problem, and its
      // list stays empty rather than a zero the handler did not read.
      return statusAnswer({ manifest: deps.manifest, version: deps.version, hostVersion: deps.hostVersion, accounts, problems, unguardedAgents: await call.unguardedAgents() })
    },
  }
}
