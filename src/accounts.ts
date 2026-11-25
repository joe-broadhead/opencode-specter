// The plugin's accounts, through the contract's `accounts` module, and its own team-key sign-in.
//
// Two different things sign in to Specter, and they must not collide:
//
// - Every account alias is Specter's own MCP server, `<name>` for `default` and `<name>-<alias>` otherwise. OpenCode
//   holds that OAuth per person, and the vendor's MCP tools are passed through under those names.
// - The plugin's own tools and the saved-search feed use the **team's** API key. It is one key for the whole team, not a
//   person's, so it is not an account: it is a separate integration, `specter-team`, and its methods are `accounts: none`.
import type { Plugin } from "@opencode/plugin"
import { registerAccounts } from "@we-the-rebel-alliance/plugin-contract/accounts"
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import { mcpServerConfig, TEAM_INTEGRATION_ID, TEAM_KEY_LABEL } from "./provider/specter.js"

/** What the wiring did, and what it could not. */
export interface AccountsWiring {
  readonly accounts: readonly { readonly alias: string; readonly name: string }[]
  /** Problems for status, each one sentence; empty when every registration succeeded. */
  readonly problems: readonly string[]
  /** The team key at call time; undefined when /connect has no key. Never throws. */
  readonly key: () => Promise<string | undefined>
}

type AccountsContext = Parameters<typeof registerAccounts>[0]

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/**
 * Registers one Specter MCP server per alias and the team-key integration. Transforms are synchronous and never throw: a
 * failure is kept for status, as the contract's accounts module does.
 */
export async function registerSpecterAccounts(context: Plugin.Context, manifest: Manifest, options: Readonly<Record<string, unknown>>): Promise<AccountsWiring> {
  const problems: string[] = []
  const accounts = await registerAccounts(context as AccountsContext, { manifest, options, server: (_account, name) => mcpServerConfig(name) })
  problems.push(...accounts.problems)

  try {
    await context.integration.transform((editor) => {
      editor.update(TEAM_INTEGRATION_ID, (integration) => {
        integration.name = TEAM_KEY_LABEL
      })
      editor.method.update({ integrationID: TEAM_INTEGRATION_ID, method: { type: "key", label: TEAM_KEY_LABEL } })
    })
  } catch (error) {
    problems.push(`UNAVAILABLE: The ${TEAM_KEY_LABEL} sign-in could not be added to /connect (${message(error)}). Next step: Restart OpenCode.`)
  }

  return {
    accounts: accounts.accounts,
    problems,
    key: async () => {
      try {
        const connection = await context.integration.connection.active(TEAM_INTEGRATION_ID)
        if (!connection) return undefined
        const value = await context.integration.connection.resolve(connection)
        return value?.type === "key" ? value.key : undefined
      } catch {
        // An unreadable credential is the same as none for a call: the refusal names /connect.
        return undefined
      }
    },
  }
}
