// The built plugin in an embedded OpenCode host, against the loopback fake. Nothing leaves the machine: close() fails
// the test if the host tried.
import { afterAll, describe, expect, test } from "bun:test"
import { KEY_INTEGRATION_ID, MCP_URL } from "../../src/constants.js"
import { defaultRules } from "../../src/permissions.js"
import { isStatus } from "../../src/rpc.js"
import { agentRules, cleanup, pluginState, specterServer, startHost, status, until } from "./harness.js"

afterAll(cleanup)

describe("the plugin in a host", () => {
  test("loads, registers the specter server, inserts the default rules and answers status with no upstream call", async () => {
    const host = await startHost()
    try {
      expect(await pluginState(host)).toBe("active")
      await until("the specter server is listed", () => specterServer(host))
      const rules = (await agentRules(host)).get("build") ?? []
      const base = rules.findIndex((rule) => rule.action === "*" && rule.resource === "*" && rule.effect === "allow")
      expect(rules.slice(base + 1, base + 1 + defaultRules("all").length)).toEqual(defaultRules("all"))
      const answer = await status(host)
      expect(isStatus(answer)).toBe(true)
      expect(answer).toMatchObject({ key: { connected: false, check: "unchecked" }, access: "all", server: { type: "plugin" } })
      // Status reads OpenCode's state only: the fake's REST API saw nothing, and no request carried a key.
      expect(host.fake.requests.filter((request) => request.path.startsWith("/api/"))).toEqual([])
      expect(host.fake.requests.some((request) => request.apiKey)).toBe(false)
    } finally {
      await host.close()
    }
  }, 120_000)

  test("declares the specter key integration, named Specter, with one key method", async () => {
    const host = await startHost()
    try {
      const integration = await until("the specter integration is listed", async () => {
        const { data } = await host.client.integration.get({ integrationID: KEY_INTEGRATION_ID, location: host.location } as never).catch(() => ({ data: undefined }))
        return data
      })
      const info = integration as { name: string; methods: { type: string }[] }
      expect(info.name).toBe("Specter")
      expect(info.methods.map((method) => method.type)).toEqual(["key"])
    } finally {
      await host.close()
    }
  }, 120_000)

  test("adopts the user's own specter entry at Specter's URL, and leaves another URL alone", async () => {
    const own = await startHost({ config: () => ({ mcp: { servers: { specter: { type: "remote", url: MCP_URL, oauth: false, headers: { "X-Test": "invented" } } } } }) })
    try {
      expect(await status(own)).toMatchObject({ server: { type: "adopted", signIn: "own" } })
    } finally {
      await own.close()
    }
    const other = await startHost({ config: (origin) => ({ mcp: { servers: { specter: { type: "remote", url: `${origin}/elsewhere` } } } }) })
    try {
      expect(await status(other)).toMatchObject({ state: "conflict", server: { type: "conflict" } })
    } finally {
      await other.close()
    }
  }, 240_000)

  test("refuses an unknown option, and a host outside the range", async () => {
    const typo = await startHost({ options: { acess: "all" } })
    try {
      expect(await pluginState(typo)).not.toBe("active")
    } finally {
      await typo.close()
    }
    const old = await startHost({ version: "2.1.0" })
    try {
      expect(await pluginState(old)).not.toBe("active")
    } finally {
      await old.close()
    }
  }, 240_000)
})
