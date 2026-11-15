import { describe, expect, it } from "vitest"
import { DISPLAY_NAME, KEY_INTEGRATION_ID, KEY_METHOD_LABEL, MCP_URL, SERVER_NAME } from "../../src/constants.js"
import { registerKeyIntegration } from "../../src/credential.js"
import { conflictUrl, displayUrl, registerServer, serverConfig } from "../../src/plugin.js"
import type { ServerSource } from "../../src/rpc.js"

/** A fake `ctx.mcp` that runs the transform once against `existing`, recording what it sets. */
function mcp(existing: unknown) {
  const set: [string, unknown][] = []
  const ctx = {
    transform: async (callback: (editor: unknown) => void) => {
      callback({ get: (name: string) => (name === SERVER_NAME ? existing : undefined), set: (name: string, config: unknown) => set.push([name, config]) })
      return { dispose: async () => undefined }
    },
  }
  return { ctx: ctx as never, set }
}

async function register(existing: unknown) {
  const fake = mcp(existing)
  const recorded: { source?: ServerSource; problem?: string }[] = []
  await registerServer(fake.ctx, serverConfig({ endpoint: MCP_URL }), (source, problem) => recorded.push({ ...(source ? { source } : {}), ...(problem ? { problem } : {}) }))
  return { set: fake.set, recorded }
}

/** A user entry whose headers throw when read: adopting it must never touch them. */
const entry = (fields: Record<string, unknown>) =>
  new Proxy(fields, {
    get(target, key) {
      if (key === "headers") throw new Error("the plugin read the user's headers")
      return target[key as string]
    },
  })

describe("the MCP server", () => {
  it("registers Specter's hosted server when the user has none, with the host's defaults", async () => {
    const { set, recorded } = await register(undefined)
    expect(set).toEqual([[SERVER_NAME, { type: "remote", url: MCP_URL }]])
    expect(recorded).toEqual([{ source: { type: "plugin", url: displayUrl(MCP_URL) } }])
  })

  it("adopts the user's own entry at Specter's URL unchanged, reading only type, url and oauth === false", async () => {
    const oauth = await register(entry({ type: "remote", url: `${MCP_URL}/` }))
    expect(oauth.set).toEqual([])
    expect(oauth.recorded).toEqual([{ source: { type: "adopted", url: displayUrl(MCP_URL), signIn: "oauth" } }])
    const own = await register(entry({ type: "remote", url: MCP_URL, oauth: false }))
    expect(own.recorded).toEqual([{ source: { type: "adopted", url: displayUrl(MCP_URL), signIn: "own" } }])
  })

  it("leaves a server at another URL, or a local command, alone as a conflict", async () => {
    const other = await register(entry({ type: "remote", url: "https://mcp.example.invalid/secret-path" }))
    expect(other.set).toEqual([])
    expect(other.recorded).toEqual([{ source: { type: "conflict", url: "https://mcp.example.invalid/…", expected: displayUrl(MCP_URL) } }])
    const local = await register(entry({ type: "local", command: ["specter-mcp"] }))
    expect(local.recorded[0]?.source?.type).toBe("conflict")
  })

  it("never throws from the transform; a failure is reported", async () => {
    const recorded: (string | undefined)[] = []
    const ctx = { transform: async (callback: (editor: unknown) => void) => (callback({ get: () => { throw new Error("broken host") } }), { dispose: async () => undefined }) }
    await registerServer(ctx as never, serverConfig({ endpoint: MCP_URL }), (_source, problem) => recorded.push(problem))
    expect(recorded[0]).toMatch(/^SERVER_NOT_REGISTERED: /)
  })

  it("shows URLs as origin and path only", () => {
    expect(displayUrl("https://mcp.example.invalid/mcp/?token=abc")).toBe("https://mcp.example.invalid/mcp")
    expect(conflictUrl("https://other.example.invalid/key/abc", MCP_URL)).toBe("https://other.example.invalid/…")
  })
})

describe("the key integration (B1)", () => {
  it("names the integration and adds one key method, and no env method", async () => {
    const calls: unknown[] = []
    const integration = { name: "" }
    const ctx = {
      integration: {
        transform: async (callback: (editor: unknown) => void) => {
          callback({
            update: (id: string, change: (item: typeof integration) => void) => (calls.push(["update", id]), change(integration)),
            method: { update: (input: unknown) => calls.push(["method", input]) },
          })
          return { dispose: async () => void calls.push(["dispose"]) }
        },
      },
    }
    const problems: (string | undefined)[] = []
    const registration = await registerKeyIntegration(ctx as never, (problem) => problems.push(problem))
    expect(integration.name).toBe(DISPLAY_NAME)
    expect(calls).toEqual([
      ["update", KEY_INTEGRATION_ID],
      ["method", { integrationID: KEY_INTEGRATION_ID, method: { type: "key", label: KEY_METHOD_LABEL } }],
    ])
    expect(JSON.stringify(calls)).not.toContain('"env"')
    expect(problems).toEqual([undefined])
    await registration.dispose()
    expect(calls.at(-1)).toEqual(["dispose"])
  })

  it("never throws from the transform; a failure is reported", async () => {
    const ctx = { integration: { transform: async (callback: (editor: unknown) => void) => (callback({ update: () => { throw new Error("broken host") } }), { dispose: async () => undefined }) } }
    const problems: (string | undefined)[] = []
    await registerKeyIntegration(ctx as never, (problem) => problems.push(problem))
    expect(problems[0]).toMatch(/^INTEGRATION_NOT_REGISTERED: /)
  })
})
