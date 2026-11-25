import type { Plugin } from "@opencode/plugin"
import { describe, expect, test } from "vitest"
import { registerSpecterAccounts } from "../../src/accounts.js"
import { manifest } from "../../src/manifest.js"
import { TEAM_INTEGRATION_ID, TEAM_KEY_LABEL } from "../../src/provider/specter.js"
import { INVENTED_KEY } from "./helpers.js"

/** A context with the three domains the wiring uses, and no host. */
function context(connection: { active: unknown; key?: string } = { active: true }) {
  const servers = new Map<string, unknown>()
  const integrations = new Map<string, { name: string }>()
  const methods: { integrationID: string; method: { type: string; label: string } }[] = []
  const ctx = {
    mcp: {
      transform: async (callback: (editor: { set(name: string, config: unknown): void }) => void) => callback({ set: (name, config) => void servers.set(name, config) }),
    },
    integration: {
      transform: async (callback: (editor: unknown) => void) =>
        callback({
          update: (id: string, update: (integration: { id: string; name: string }) => void) => {
            const integration = { id, name: "" }
            update(integration)
            integrations.set(id, integration)
          },
          method: { update: (registration: { integrationID: string; method: { type: string; label: string } }) => void methods.push(registration) },
        }),
      connection: {
        active: async () => (connection.active ? { type: "credential", id: "conn_1" } : undefined),
        resolve: async () => (connection.key === undefined ? undefined : { type: "key", key: connection.key }),
      },
    },
  }
  return { ctx: ctx as unknown as Plugin.Context, servers, integrations, methods }
}

describe("accounts wiring", () => {
  test("registers one Specter MCP server per alias, and the team key as its own integration", async () => {
    const { ctx, servers, integrations, methods } = context({ active: true, key: INVENTED_KEY })
    const wiring = await registerSpecterAccounts(ctx, manifest, { accounts: { work: {}, personal: {} } })
    expect([...servers.keys()].sort()).toEqual(["specter-personal", "specter-work"])
    expect(servers.get("specter-work")).toEqual({ type: "remote", url: "https://mcp.tryspecter.com/mcp" })
    expect(integrations.has(TEAM_INTEGRATION_ID)).toBe(true)
    expect(integrations.has("specter")).toBe(false)
    expect(integrations.get(TEAM_INTEGRATION_ID)?.name).toBe(TEAM_KEY_LABEL)
    expect(methods).toEqual([{ integrationID: TEAM_INTEGRATION_ID, method: { type: "key", label: TEAM_KEY_LABEL } }])
    expect(wiring.accounts).toEqual([
      { alias: "work", name: "specter-work" },
      { alias: "personal", name: "specter-personal" },
    ])
    expect(wiring.problems).toEqual([])
    expect(await wiring.key()).toBe(INVENTED_KEY)
  })

  test("one account with no alias is the specter server", async () => {
    const { ctx, servers } = context()
    const wiring = await registerSpecterAccounts(ctx, manifest, {})
    expect([...servers.keys()]).toEqual(["specter"])
    expect(wiring.accounts).toEqual([{ alias: "default", name: "specter" }])
  })

  test("no key, or a credential that is not a key, is undefined rather than an error", async () => {
    expect(await (await registerSpecterAccounts(context({ active: false }).ctx, manifest, {})).key()).toBeUndefined()
    expect(await (await registerSpecterAccounts(context({ active: true }).ctx, manifest, {})).key()).toBeUndefined()
  })
})
