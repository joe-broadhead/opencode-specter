// The built plugin in an embedded OpenCode host, against the loopback fake. Nothing leaves the machine: close() fails
// the test if the host tried.
import { afterAll, describe, expect, test } from "bun:test"
import { request as httpRequest } from "node:http"
import { KEY_INTEGRATION_ID, MCP_URL } from "../../src/constants.js"
import { defaultRules } from "../../src/permissions.js"
import { isStatus } from "../../src/rpc.js"
import { DUMMY_KEY } from "../unit/fake.js"
import { AUTHORIZATION_SERVER, FAKE_COMPANY, FAKE_SEARCHES, PROTECTED_RESOURCE, SPECTER_MCP_ORIGIN } from "./fake-specter.js"
import { agentRules, cleanup, pluginState, session, specterServer, startHost, status, until } from "./harness.js"

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

let calls = 0

/**
 * Runs one of the plugin's own tools through the host's own executor, as the agent's session: any permission prompt is
 * answered `decision`, and the call's output or error is returned. It proves the tool's key, its REST call and its
 * permission, end to end.
 */
async function run(host: Awaited<ReturnType<typeof startHost>>, sessionID: string, tool: string, input: Record<string, unknown>, decision: "once" | "always" | "reject" = "reject") {
  const executor = await until(`specter_${tool} is registered`, async () => (await host.probe().tool.list()).find((item) => item.id === `specter_${tool}`))
  const context = { sessionID, agent: "build", messageID: "msg_host_test", id: `call_host_test_${++calls}`, signal: new AbortController().signal, progress: async () => {} }
  let settled = false
  const result = executor.execute(input as never, context as never).then(
    (value) => ({ ok: true as const, value: value as { output?: unknown; content?: unknown } }),
    (error: unknown) => ({ ok: false as const, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
  ).finally(() => (settled = true))
  let asked: string | undefined
  while (!settled) {
    const pending = await host.client.permission.list({ sessionID })
    const request = pending.find((item) => item.action === `specter_${tool}` || item.action === "specter.read" || item.action === "specter_get_company")
    if (request) {
      asked = request.action
      await host.client.permission.reply({ sessionID, requestID: request.id, decision })
      break
    }
    await Promise.race([result, Bun.sleep(25)])
  }
  return { asked, ...(await result) }
}

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
      // OpenCode found the sign-in from Specter's challenge and the two metadata documents.
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
      // OpenCode 2.4.1 probes `server/discover` first when the server declares no protocol. Those attempts carry no
      // token (the 401 challenge is what starts the sign-in above), and the signed-in connection then falls back to
      // `initialize` because the fake, like an ordinary server, does not serve the modern revision.
      const rpcs = host.fake.requests.flatMap((request) => (request.rpc === undefined ? [] : [request.rpc]))
      const unauthenticated = host.fake.requests.flatMap((request) => (request.rpc === undefined || request.bearer ? [] : [request.rpc]))
      expect(rpcs[0]).toBe("server/discover")
      expect(unauthenticated).toContain("server/discover")
      expect(unauthenticated.filter((rpc) => rpc !== "server/discover" && rpc !== "initialize")).toEqual([])
      expect(rpcs).toContain("initialize")
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

  test("runs the plugin's own free read against Specter with the team key, and the source's page on it", async () => {
    const host = await startHost()
    try {
      host.fake.keys.add(DUMMY_KEY)
      await host.client.integration.connect.key({ integrationID: KEY_INTEGRATION_ID, key: DUMMY_KEY, label: "team", location: host.location } as never)
      const sessionID = await session(host)
      // The free reads are allowed at every access, so nothing asks.
      const listed = await run(host, sessionID, "list_saved_searches", {})
      expect(listed.asked).toBeUndefined()
      expect(listed.ok && (listed.value.output as { options: unknown[] }).options).toEqual([{ id: "5432", label: `${FAKE_SEARCHES[0]!.name} (companies, 1 new, 2 total)` }])
      const resolved = await run(host, sessionID, "search_companies", { domains: [FAKE_COMPANY.website.domain] })
      expect(resolved.ok && (resolved.value.output as { resolved: { matches: { id: string }[] }[] }).resolved[0]!.matches[0]!.id).toBe(FAKE_COMPANY.id)
      // The source contract's read: its action and its operation are allowed, so nothing asks, and the page names the
      // plugin's package and a cursor.
      // An hour ago: a `since` older than Specter's 60-day window would answer a gap instead of a page.
      const since = new Date(Date.now() - 3_600_000).toISOString()
      const page = await run(host, sessionID, "events_list", { scope: { search: "5432" }, since })
      expect(page.asked).toBeUndefined()
      const output = page.ok ? (page.value.output as { events: { external_id: string; occurred_at: string }[]; cursor: string; plugin: string; scope: Record<string, string> }) : undefined
      expect(output?.events.map((event) => event.external_id)).toEqual(["company:hedgehog"])
      expect(output?.cursor).toEqual(expect.any(String))
      expect(output?.plugin).toBe("@we-the-rebel-alliance/specter-plugin")
      expect(output?.scope).toEqual({ search: "5432" })
      // Every REST call carried the key in X-API-Key and nothing else, and only the documented paths were asked.
      const rest = host.fake.requests.filter((request) => request.path.startsWith("/api/"))
      expect(rest.every((request) => request.apiKey && !request.bearer)).toBe(true)
      expect(rest.map((request) => `${request.method} ${request.path}`)).toContain("GET /api/v1/searches")
      expect(rest.map((request) => `${request.method} ${request.path}`)).toContain("GET /api/v1/searches/companies/5432/results")
      expect(JSON.stringify([listed, resolved, page])).not.toContain(DUMMY_KEY)
    } finally {
      await host.close()
    }
  }, 240_000)

  test("treats a call that spends credits as a change: allowed at all, denied at read-only", async () => {
    const host = await startHost()
    try {
      host.fake.keys.add(DUMMY_KEY)
      await host.client.integration.connect.key({ integrationID: KEY_INTEGRATION_ID, key: DUMMY_KEY, label: "team", location: host.location } as never)
      const sessionID = await session(host)
      const charged = await run(host, sessionID, "get_company", { id: FAKE_COMPANY.id })
      expect(charged.asked).toBeUndefined()
      expect(charged.ok && (charged.value.output as { cost: { credits: number } }).cost.credits).toBe(1)
    } finally {
      await host.close()
    }
    const ro = await startHost({ options: { access: "read-only" } })
    try {
      ro.fake.keys.add(DUMMY_KEY)
      await ro.client.integration.connect.key({ integrationID: KEY_INTEGRATION_ID, key: DUMMY_KEY, label: "team", location: ro.location } as never)
      const sessionID = await session(ro)
      const denied = await run(ro, sessionID, "get_company", { id: FAKE_COMPANY.id })
      expect(denied.ok).toBe(false)
      expect(!denied.ok && denied.error).toMatch(/permission|denied/i)
      expect(ro.fake.requests.filter((request) => request.path === `/api/v1/companies/${FAKE_COMPANY.id}`)).toEqual([])
      // A free read still runs with no key spend.
      expect((await run(ro, sessionID, "list_saved_searches", {})).ok).toBe(true)
    } finally {
      await ro.close()
    }
  }, 300_000)

  test("refuses an unknown option, and a host outside the range", async () => {
    const typo = await startHost({ options: { acess: "all" } })
    try {
      expect(await pluginState(typo)).toMatchObject({ status: "failed", error: expect.stringContaining("OPTIONS_INVALID") })
    } finally {
      await typo.close()
    }
    const old = await startHost({ version: "2.5.0" })
    try {
      expect(await pluginState(old)).toMatchObject({ status: "failed", error: expect.stringContaining("HOST_UNTESTED") })
    } finally {
      await old.close()
    }
  }, 240_000)
})
