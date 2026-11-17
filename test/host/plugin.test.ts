// The built plugin in an embedded OpenCode host, against the loopback fake. Nothing leaves the machine: close() fails
// the test if the host tried.
import { afterAll, describe, expect, test } from "bun:test"
import { request as httpRequest } from "node:http"
import { KEY_INTEGRATION_ID, MCP_URL } from "../../src/constants.js"
import { defaultRules } from "../../src/permissions.js"
import { isStatus } from "../../src/rpc.js"
import { DUMMY_KEY } from "../unit/fake.js"
import { AUTHORIZATION_SERVER, PROTECTED_RESOURCE, SPECTER_MCP_ORIGIN } from "./fake-specter.js"
import { agentRules, cleanup, pluginState, specterServer, startHost, status, until } from "./harness.js"

/** A GET over plain HTTP, outside the fetch router, which allows no loopback but the fake and follows no redirect. */
function get(url: string): Promise<{ status: number; location: string | null }> {
  return new Promise((resolve, reject) => {
    const sent = httpRequest(url, { method: "GET" }, (response) => {
      response.resume()
      resolve({ status: response.statusCode ?? 0, location: response.headers.location ?? null })
    })
    sent.on("error", reject)
    sent.end()
  })
}

afterAll(cleanup)

describe("the plugin in a host", () => {
  test("loads, registers the specter server, inserts the default rules and answers status with no upstream call", async () => {
    const host = await startHost()
    try {
      expect(await pluginState(host)).toEqual({ status: "active" })
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

  test("checks a connected key against Specter's free credit balance, with the key only in X-API-Key", async () => {
    const host = await startHost()
    try {
      host.fake.keys.add(DUMMY_KEY)
      await host.client.integration.connect.key({ integrationID: KEY_INTEGRATION_ID, key: DUMMY_KEY, label: "team", location: host.location } as never)
      const accepted = await until("status reports the key accepted", async () => {
        const answer = await status(host)
        return answer.key.check === "accepted" ? answer : undefined
      })
      expect(accepted.key).toEqual({ connected: true, label: "team", check: "accepted" })
      const checks = host.fake.requests.filter((request) => request.path.startsWith("/api/"))
      expect(checks.map((request) => `${request.method} ${request.path}`)).toEqual(["GET /api/v1/organization/credits"])
      expect(checks.every((request) => request.apiKey && !request.bearer)).toBe(true)
      // Status never shows the key.
      expect(JSON.stringify(accepted)).not.toContain(DUMMY_KEY)
    } finally {
      await host.close()
    }
    const wrong = await startHost()
    try {
      await wrong.client.integration.connect.key({ integrationID: KEY_INTEGRATION_ID, key: DUMMY_KEY, label: "team", location: wrong.location } as never)
      const rejected = await until("status reports the key rejected", async () => {
        const answer = await status(wrong)
        return answer.key.check === "rejected" ? answer : undefined
      })
      expect(rejected.key).toEqual({ connected: true, label: "team", check: "rejected" })
      // The MCP sign-in's step comes first; the fake's server still asks for a sign-in.
      expect(rejected.nextStep).toBe("Open /mcps, choose specter and sign in.")
    } finally {
      await wrong.close()
    }
  }, 240_000)

  // Specter advertises both registration routes; OpenCode prefers a client ID metadata document, and registers
  // dynamically when the server does not offer one.
  test.each(["cimd", "dcr"] as const)("completes OpenCode's sign-in against Specter's published OAuth metadata (%s), then lists the server's tools", async (route) => {
    const host = await startHost({ fake: { cimd: route === "cimd" } })
    try {
      const server = await until("the specter server asks for a sign-in", async () => {
        const found = await specterServer(host)
        return found?.status.status === "needs_auth" ? found : undefined
      })
      const integrationID = server.integrationID!
      const { data: integration } = await host.client.integration.get({ integrationID, location: host.location } as never)
      const oauth = (host.client.integration as unknown as { oauth: { connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }> } }).oauth
      const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration as unknown as { methods: { id: string }[] }).methods[0]!.id, location: host.location })
      // The browser's part: Specter's authorization endpoint (here the fake, at Specter's address) consents and
      // redirects to OpenCode's loopback callback.
      expect(attempt.url.startsWith(AUTHORIZATION_SERVER.authorization_endpoint)).toBe(true)
      const consent = await get(attempt.url.replace(SPECTER_MCP_ORIGIN, host.fake.origin))
      expect(consent.status).toBe(302)
      expect(consent.location).toMatch(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//)
      expect(new URL(consent.location!).searchParams.get("iss")).toBe(AUTHORIZATION_SERVER.issuer)
      await get(consent.location!)
      const signedIn = await until("the server connects and OpenCode lists its tools", async () => {
        const answer = await status(host)
        return answer.state === "connected" && answer.tools.visible === 2 ? answer : undefined
      }, 60_000)
      // Both invented tools are unclassified, so the default rules treat them like changes.
      expect(signedIn.tools.unknown).toEqual(["specter_fake_other_tool", "specter_fake_read_tool"])
      // OpenCode found the sign-in from Specter's challenge and the two metadata documents (2.3.0 reads them only when
      // the sign-in starts, earlier releases already when the server first asks for one).
      expect(host.fake.discovery).toContain("/.well-known/oauth-protected-resource/mcp")
      expect(host.fake.discovery).toContain("/.well-known/oauth-authorization-server")
      // A registration route Specter advertises, PKCE S256 and the documented scope; the code exchanged with a verifier.
      expect(host.fake.signIns).toHaveLength(1)
      const [signIn] = host.fake.signIns
      expect(signIn!.registration).toBe(route)
      expect(signIn!.codeChallengeMethod).toBe("S256")
      // The scope and resource Specter's metadata names, nothing more.
      expect(signIn!.scope).toBe("openid")
      expect(signIn!.resource).toBe(PROTECTED_RESOURCE.resource)
      expect(host.fake.tokens[0]).toMatchObject({ grant: "authorization_code", verifier: true })
      // The MCP sign-in never touches the REST API or the team key.
      expect(host.fake.requests.filter((request) => request.path.startsWith("/api/") || request.apiKey)).toEqual([])
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
      expect(await pluginState(typo)).toMatchObject({ status: "failed", error: expect.stringContaining("OPTIONS_INVALID") })
    } finally {
      await typo.close()
    }
    const old = await startHost({ version: "2.1.0" })
    try {
      expect(await pluginState(old)).toMatchObject({ status: "failed", error: expect.stringContaining("HOST_UNTESTED") })
    } finally {
      await old.close()
    }
  }, 240_000)
})
