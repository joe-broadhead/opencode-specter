// The built plugin in an embedded OpenCode 2.4.1 host, against the loopback fake. Nothing leaves the machine: close()
// fails the test if the host tried.
import { afterAll, describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { request as httpRequest } from "node:http"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { parse as parseYaml } from "yaml"
import { AUTHORIZATION_SERVER, FAKE_COMPANY, FAKE_SEARCHES, SPECTER_MCP_ORIGIN } from "./fake-specter.js"
import { agentRules, cleanup, pluginState, rpc, session, sessionWithRules, specterServer, startHost, status, until, type Host } from "./harness.js"

afterAll(cleanup)

/** An invented team key: never a real one. */
const TEAM_KEY = "team-key-for-the-host-test"
/** The team-key integration's id, which is not an account. */
const TEAM_INTEGRATION = "specter-team"
/** The skill directories the package ships, read from disk: the test asserts what the plugin registers. */
const REPO = fileURLToPath(new URL("../../", import.meta.url))
const DISK_SKILLS = readdirSync(join(REPO, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()

let calls = 0

/**
 * Runs one of the plugin's tools through the host's own executor, as the agent's session: any permission prompt is
 * answered `decision`, and the call's output or error is returned.
 */
async function toolRun(host: Host, sessionID: string, method: string, input: Record<string, unknown>, decision: "once" | "always" | "reject" = "once") {
  const executor = await until(`specter_${method} is registered`, async () => (await host.probe().tool.list()).find((item) => item.id === `specter_${method}`))
  const context = { sessionID, agent: "build", messageID: "msg_host_test", id: `call_host_test_${++calls}`, signal: new AbortController().signal, progress: async () => {} }
  let settled = false
  const result = executor
    .execute(input as never, context as never)
    .then(
      (value) => ({ ok: true as const, value: value as { output?: unknown; content?: unknown } }),
      (error: unknown) => ({ ok: false as const, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) }),
    )
    .finally(() => (settled = true))
  let asked: string | undefined
  while (!settled) {
    const pending = await host.client.permission.list({ sessionID })
    const request = pending.find((item) => item.action === `specter.${method}`)
    if (request) {
      asked = request.action
      await host.client.permission.reply({ sessionID, requestID: request.id, decision })
      break
    }
    await Promise.race([result, Bun.sleep(25)])
  }
  return { asked, ...(await result) }
}

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

describe("the plugin in a host", () => {
  test("registers one Specter server per alias, the team-key integration, and answers status", async () => {
    const host = await startHost({ options: { access: "all", accounts: { work: {}, personal: {} } } })
    try {
      expect(await pluginState(host)).toEqual({ status: "active" })
      await until("the work server is listed", () => specterServer(host, "specter-work"))
      await until("the personal server is listed", () => specterServer(host, "specter-personal"))
      await until("both servers ask for a sign-in", async () => {
        const work = await specterServer(host, "specter-work")
        const personal = await specterServer(host, "specter-personal")
        return work?.status.status === "needs_auth" && personal?.status.status === "needs_auth"
      })
      const { data } = await host.client.integration.get({ integrationID: TEAM_INTEGRATION, location: host.location } as never)
      expect((data as { name: string }).name).toBe("Specter team API key")
      expect(((data as { methods: { type: string }[] }).methods ?? []).map((method) => method.type)).toEqual(["key"])

      const answer = await status(host)
      expect(answer.ok).toBe(true)
      if (!answer.ok) return
      expect(answer.output).toMatchObject({
        name: "specter",
        host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
        state: "needs_sign_in",
        accounts: [
          { alias: "work", state: "needs_sign_in" },
          { alias: "personal", state: "needs_sign_in" },
        ],
        unguardedAgents: [],
        nextStep: "Sign in to the account that needs it, then read status again.",
      })
      // The rules are generated per alias: the pass-through tools are changes, the credit-spending reads ask.
      const rules = (await agentRules(host)).get("build") ?? []
      expect(rules).toContainEqual({ action: "specter-work_*", resource: "*", effect: "allow" })
      expect(rules).toContainEqual({ action: "specter-personal_*", resource: "*", effect: "allow" })
      expect(rules).toContainEqual({ action: "specter.get_company", resource: "*", effect: "ask" })
      expect(rules).toContainEqual({ action: "specter.list_saved_searches", resource: "*", effect: "allow" })
      // Status makes no upstream call.
      expect(host.fake.requests.filter((request) => request.path.startsWith("/api/"))).toEqual([])
      expect(JSON.stringify(answer.output)).not.toContain(TEAM_KEY)
    } finally {
      await host.close()
    }
  }, 240_000)

  test("registers the default account as the specter MCP server", async () => {
    const host = await startHost()
    try {
      await until("the default specter server is listed", () => specterServer(host, "specter"))
      const { data } = await host.client.mcp.list({ location: host.location })
      // No accounts option means one default account, whose server is the bare plugin name, never `specter-default`.
      expect(data.map((server) => server.name).filter((name) => name === "specter" || name.startsWith("specter-"))).toEqual(["specter"])
    } finally {
      await host.close()
    }
  }, 240_000)

  test("parity: every own method is a host tool", async () => {
    const host = await startHost()
    try {
      const tools = await host.probe().tool.list()
      const own = tools.map((tool) => tool.id).filter((id) => id.startsWith("specter_")).sort()
      expect(own).toEqual([
        "specter_events_list",
        "specter_get_company",
        "specter_list_saved_searches",
        "specter_probe",
        "specter_saved_search_results",
        "specter_search_companies",
        "specter_status",
      ])
    } finally {
      await host.close()
    }
  }, 120_000)

  test("registers every skills/*/SKILL.md in the real host", async () => {
    const host = await startHost()
    try {
      const { data } = await host.client.skill.list({ location: host.location })
      const ours = data
        .map((skill) => ({ id: String(skill.id), path: String(skill.path), description: String(skill.description) }))
        .filter((skill) => DISK_SKILLS.includes(skill.id))
        .sort((left, right) => left.id.localeCompare(right.id))
      expect(ours.map((skill) => skill.id)).toEqual(DISK_SKILLS)
      for (const skill of ours) {
        expect(skill.path).toBe(join(REPO, "skills", skill.id, "SKILL.md"))
        // The registered description is one plain line, never empty or a block-scalar marker the loader cannot read.
        expect(skill.description, skill.id).not.toBe("")
        expect(skill.description, skill.id).not.toBe(">")
        expect(skill.description, skill.id).not.toBe("|")
        expect(skill.description.startsWith("> ") || skill.description.startsWith("| "), skill.id).toBe(false)
        // And it is exactly what the file's YAML frontmatter says.
        const frontmatter = /^---\n([\s\S]*?)\n---/.exec(readFileSync(skill.path, "utf8"))
        expect(frontmatter, skill.id).not.toBeNull()
        const parsed = parseYaml(frontmatter![1]!) as { description?: unknown }
        expect(typeof parsed.description, skill.id).toBe("string")
        expect(skill.description, skill.id).toBe(parsed.description as string)
      }
    } finally {
      await host.close()
    }
  }, 120_000)

  test("its own tools read Specter with the team key, spend credits, and never leak the key", async () => {
    const host = await startHost({ options: { access: "all", accounts: { work: {}, personal: {} } } })
    try {
      host.fake.keys.add(TEAM_KEY)
      await host.client.integration.connect.key({ integrationID: TEAM_INTEGRATION, key: TEAM_KEY, label: "team", location: host.location } as never)
      const sessionID = await session(host)

      // Free reads run without asking.
      const listed = await toolRun(host, sessionID, "list_saved_searches", {})
      expect(listed.asked).toBeUndefined()
      expect(listed.ok && (listed.value.output as { options: unknown[] }).options).toEqual([{ id: "5432", label: `${FAKE_SEARCHES[0]!.name} (companies, 1 new, 2 total)` }])
      const resolved = await toolRun(host, sessionID, "search_companies", { domains: [FAKE_COMPANY.website.domain] })
      expect(resolved.ok && (resolved.value.output as { resolved: { matches: { id: string }[] }[] }).resolved[0]!.matches[0]!.id).toBe(FAKE_COMPANY.id)

      // Credit-spending reads ask at every level, including all.
      const charged = await toolRun(host, sessionID, "get_company", { id: FAKE_COMPANY.id })
      expect(charged.asked).toBe("specter.get_company")
      expect(charged.ok && (charged.value.output as { cost: { credits: number } }).cost.credits).toBe(1)
      const results = await toolRun(host, sessionID, "saved_search_results", { searchId: "5432" })
      expect(results.asked).toBe("specter.saved_search_results")
      expect(results.ok && (results.value.output as { companies: unknown[] }).companies).toHaveLength(1)

      // The feed, for one account: its page names that account, and its probe names the key's fingerprint.
      const since = new Date(Date.now() - 3_600_000).toISOString()
      const page = await toolRun(host, sessionID, "events_list", { account: "work", scope: { search: "5432" }, since })
      expect(page.asked).toBe("specter.events_list")
      const output = page.ok ? (page.value.output as { account: string; events: { external_id: string }[]; cursor: string; plugin: string; scope: Record<string, string> }) : undefined
      expect(output?.account).toBe("work")
      expect(output?.events.map((event) => event.external_id)).toEqual([`company:${FAKE_COMPANY.id}`])
      expect(output?.cursor).toEqual(expect.any(String))
      expect(output?.plugin).toBe("@we-the-rebel-alliance/specter-plugin")
      expect(output?.scope).toEqual({ search: "5432" })
      const probe = await rpc(host, "probe", { account: "work" }, sessionID)
      expect(probe.ok && (probe.output as { owner: { id: string } }).owner.id).toMatch(/^specter:key:[0-9a-f]{16}$/)
      expect(probe.ok && (probe.output as { account: string }).account).toBe("work")

      // Every REST call carried the key in X-API-Key and nothing else, and only documented paths were asked.
      const rest = host.fake.requests.filter((request) => request.path.startsWith("/api/"))
      expect(rest.every((request) => request.apiKey && !request.bearer)).toBe(true)
      expect(rest.map((request) => `${request.method} ${request.path}`)).toContain("GET /api/v1/searches")
      expect(rest.map((request) => `${request.method} ${request.path}`)).toContain("GET /api/v1/searches/companies/5432/results")
      expect(JSON.stringify([listed, resolved, charged, results, page, probe])).not.toContain(TEAM_KEY)
      // A cursor from work is refused under personal.
      const crossed = await toolRun(host, sessionID, "events_list", { account: "personal", scope: { search: "5432" }, cursor: output!.cursor })
      expect(crossed.ok).toBe(false)
      expect(!crossed.ok && crossed.error).toMatch(/CURSOR_INVALID/)
      expect(host.fake.requests.some((request) => request.path === "/api/v1/searches/companies/5432/results")).toBe(true)
    } finally {
      await host.close()
    }
  }, 300_000)

  // Specter advertises both registration routes; OpenCode prefers a client ID metadata document, and registers dynamically
  // when the server does not offer one.
  test.each(["cimd", "dcr"] as const)("completes OpenCode's sign-in against Specter's published OAuth metadata (%s), then lists the server's tools", async (route) => {
    const host = await startHost({ options: { access: "all", accounts: { work: {} } }, fake: { cimd: route === "cimd" } })
    try {
      const server = await until("the specter-work server asks for a sign-in", async () => {
        const found = await specterServer(host, "specter-work")
        return found?.status.status === "needs_auth" ? found : undefined
      })
      const integrationID = server.integrationID!
      const { data: integration } = await host.client.integration.get({ integrationID, location: host.location } as never)
      const oauth = (host.client.integration as unknown as { oauth: { connect: (input: object) => Promise<{ data: { attemptID: string; url: string } }> } }).oauth
      const { data: attempt } = await oauth.connect({ integrationID, methodID: (integration as unknown as { methods: { id: string }[] }).methods[0]!.id, location: host.location })
      // The browser's part: Specter's authorization endpoint (here the fake, at Specter's address) consents and redirects
      // to OpenCode's loopback callback.
      expect(attempt.url.startsWith(AUTHORIZATION_SERVER.authorization_endpoint)).toBe(true)
      const consent = await get(attempt.url.replace(SPECTER_MCP_ORIGIN, host.fake.origin))
      expect(consent.status).toBe(302)
      expect(consent.location).toMatch(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+\//)
      expect(new URL(consent.location!).searchParams.get("iss")).toBe(AUTHORIZATION_SERVER.issuer)
      await get(consent.location!)
      const signedIn = await until(
        "the server connects and OpenCode lists its tools",
        async () => {
          const answer = await status(host)
          const accounts = answer.ok ? (answer.output["accounts"] as { state?: string }[] | undefined) : undefined
          return accounts?.[0]?.state === "ready" && (await host.probe().tool.list()).some((tool) => tool.id.startsWith("specter-work_fake_")) ? answer : undefined
        },
        60_000,
      )
      expect(signedIn.ok).toBe(true)
      const vendorTools = (await host.probe().tool.list())
        .map((tool) => tool.id)
        .filter((id) => id.startsWith("specter-work_"))
        .sort()
      expect(vendorTools).toEqual(["specter-work_fake_other_tool", "specter-work_fake_read_tool"])
      // OpenCode 2.4.1 probes `server/discover` first when the server declares no protocol, and the 401 is the challenge
      // that starts the sign-in. The real host also sends one legacy `initialize` after that 401; standard §8 item 4 says
      // no `initialize` follows. That is a host/standard discrepancy, recorded in the PR, not a plugin behaviour. The
      // 401-final rule itself is proved against the contract's own harness in test/unit/mcp-probe.test.ts, so this host
      // test asserts what the host must do: discover first, no unauthenticated `tools/list`, and a listing only with the
      // bearer.
      const requests = host.fake.requests.filter((request) => request.rpc !== undefined)
      const unauthenticated = requests.filter((request) => !request.bearer).map((request) => request.rpc)
      expect(unauthenticated[0]).toBe("server/discover")
      // The real 2.4.1 host sends one legacy initialize after that 401; standard §8 item 4 says it should not. This is
      // the host's known fallback, not a contract behaviour; the 401-final rule is proved against the contract's own
      // harness in test/unit/mcp-probe.test.ts.
      expect(unauthenticated).toContain("initialize")
      expect(requests.filter((request) => request.rpc === "tools/list" && !request.bearer)).toEqual([])
      expect(requests.filter((request) => request.rpc === "tools/list").every((request) => request.bearer)).toBe(true)
      // The two invented tools are passed through under the server's name, and the generated rule treats them as changes.
      const rules = (await agentRules(host)).get("build") ?? []
      expect(rules).toContainEqual({ action: "specter-work_*", resource: "*", effect: "allow" })
      // The sign-in never touches the REST API or the team key.
      expect(host.fake.requests.filter((request) => request.path.startsWith("/api/") || request.apiKey)).toEqual([])
    } finally {
      await host.close()
    }
  }, 240_000)

  test("register's one gate asserts each declared operation: a deny on default:companies.get refuses get_company", async () => {
    const host = await startHost({ options: { access: "all", accounts: { work: {} } } })
    try {
      host.fake.keys.add(TEAM_KEY)
      await host.client.integration.connect.key({ integrationID: TEAM_INTEGRATION, key: TEAM_KEY, label: "team", location: host.location } as never)
      // `accounts: none` methods run as the register's internal `default` account, so that is the resource its gate names.
      const sessionID = await sessionWithRules(host, [{ action: "specter.get_company", resource: "default:companies.get", effect: "deny" }])
      const denied = await toolRun(host, sessionID, "get_company", { id: FAKE_COMPANY.id })
      expect(denied.ok).toBe(false)
      expect(!denied.ok && denied.error).toMatch(/PERMISSION_DENIED/)
      expect(host.fake.requests.filter((request) => request.path === `/api/v1/companies/${FAKE_COMPANY.id}`)).toEqual([])
    } finally {
      await host.close()
    }
  }, 240_000)

  test("a credit-spending read asks and a refusal stops it; a free read still runs", async () => {
    const host = await startHost({ options: { access: "ask-changes", accounts: { work: {} } } })
    try {
      host.fake.keys.add(TEAM_KEY)
      await host.client.integration.connect.key({ integrationID: TEAM_INTEGRATION, key: TEAM_KEY, label: "team", location: host.location } as never)
      const sessionID = await session(host)
      const denied = await toolRun(host, sessionID, "get_company", { id: FAKE_COMPANY.id }, "reject")
      expect(denied.asked).toBe("specter.get_company")
      expect(denied.ok).toBe(false)
      expect(host.fake.requests.filter((request) => request.path === `/api/v1/companies/${FAKE_COMPANY.id}`)).toEqual([])
      expect((await toolRun(host, sessionID, "list_saved_searches", {})).ok).toBe(true)
    } finally {
      await host.close()
    }
    const readOnly = await startHost({ options: { access: "read-only", accounts: { work: {} } } })
    try {
      readOnly.fake.keys.add(TEAM_KEY)
      await readOnly.client.integration.connect.key({ integrationID: TEAM_INTEGRATION, key: TEAM_KEY, label: "team", location: readOnly.location } as never)
      const sessionID = await session(readOnly)
      const refused = await toolRun(readOnly, sessionID, "saved_search_results", { searchId: "5432" }, "reject")
      expect(refused.asked).toBe("specter.saved_search_results")
      expect(refused.ok).toBe(false)
      // The pass-through MCP tools are denied at read-only.
      expect((await agentRules(readOnly)).get("build") ?? []).toContainEqual({ action: "specter-work_*", resource: "*", effect: "deny" })
      expect((await toolRun(readOnly, sessionID, "list_saved_searches", {})).ok).toBe(true)
    } finally {
      await readOnly.close()
    }
  }, 300_000)

  test("refuses an unknown option and a host outside the range", async () => {
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
