import { describe, expect, test } from "vitest"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import { createHandlers } from "../../src/handlers/index.js"
import type { CompanyRecord } from "../../src/provider/companies.js"
import { createProvider, ownerOf, fingerprintOf, TEAM_INTEGRATION_ID } from "../../src/provider/specter.js"
import { API_KEY_HEADER } from "../../src/provider/endpoints.js"
import type { SpecterProvider } from "../../src/provider/specter.js"
import { manifest, version } from "../../src/manifest.js"
import { COMPANIES, INVENTED_KEY, SAVED, SEARCHES, answer } from "./helpers.js"

const signal = new AbortController().signal

/** A call as the register hands a handler: the account, the signal, and the agents the rules miss. */
const call = (account = "work", unguarded: readonly string[] = []): MethodCall =>
  ({
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal,
    progress: async () => {},
    account,
    unguardedAgents: async () => ({ ok: true as const, agents: unguarded }),
    door: "rpc",
  }) as unknown as MethodCall

const owner = { id: "specter:key:0123456789abcdef", label: "Specter team key 01234567" }

function fakeProvider(over: Partial<SpecterProvider> = {}): SpecterProvider {
  return {
    resolveCompanies: async (domains) => domains.map((domain) => ({ domain, matches: [{ id: "hedgehog-co", name: "Hedgehog Labs" }] })),
    getCompany: async () => COMPANIES.hedgehog as unknown as CompanyRecord,
    listSavedSearches: async () => [{ id: SEARCHES.work, label: "Bristol software (company, 2 new, 2 total)" }],
    savedSearchResults: async (input) => ({ searchId: input.searchId, page: input.page, limit: input.limit, companies: [COMPANIES.hedgehog as unknown as CompanyRecord], truncated: false, credits: 1 }),
    savedSearchPage: async () => ({
      source: "saved",
      account: "work",
      owner,
      events: [],
      cursor: "cursor",
      more: false,
      trust: "untrusted",
      cost: { units: [{ per: "company", count: 0 }] },
    }),
    owner: async () => owner,
    ...over,
  }
}

const deps = (provider: SpecterProvider = fakeProvider(), servers: () => Promise<readonly { name: string; state: "connected" | "needs_auth" }[]> = async () => []) => ({
  manifest,
  version,
  options: { accounts: { work: {}, personal: {} } },
  hostVersion: "2.4.1",
  provider,
  servers,
  problems: () => [] as readonly string[],
})

describe("the handler table", () => {
  test("declares exactly the manifest's methods", () => {
    const handlers = createHandlers(deps())
    expect(Object.keys(handlers).sort()).toEqual(["events_list", "get_company", "list_saved_searches", "probe", "saved_search_results", "search_companies", "status"])
  })

  test("status names every alias, the host range and the unguarded agents", async () => {
    const handlers = createHandlers(
      deps(fakeProvider(), async () => [
        { name: "specter-work", state: "needs_auth" },
        { name: "specter-personal", state: "connected" },
      ]),
    )
    const answer = (await handlers["status"]!.run({}, call("work", ["explore"]))) as Record<string, unknown>
    expect(answer).toMatchObject({
      name: "specter",
      version,
      host: { version: "2.4.1", range: ">=2.4.1 <2.5.0", tested: ["2.4.1"] },
      state: "needs_sign_in",
      accounts: [
        { alias: "work", state: "needs_sign_in" },
        { alias: "personal", state: "ready" },
      ],
      unguardedAgents: ["explore"],
      nextStep: "Sign in to the account that needs it, then read status again.",
    })
  })

  test("an unreadable server or agent list is unknown, never zero", async () => {
    const handlers = createHandlers(deps(fakeProvider(), async () => Promise.reject(new Error("the host did not answer"))))
    const answer = (await handlers["status"]!.run({}, call())) as Record<string, unknown>
    expect(answer["state"]).toBe("error")
    expect(answer["accounts"]).toEqual([
      { alias: "work", state: "error", reason: "OpenCode did not report its MCP servers: the host did not answer" },
      { alias: "personal", state: "error", reason: "OpenCode did not report its MCP servers: the host did not answer" },
    ])
    const agentsFail = createHandlers(deps())
    const noAgents = (await agentsFail["status"]!.run({}, { ...call(), unguardedAgents: async () => ({ ok: false as const, error: "OpenCode did not report its agents: no list" }) })) as Record<string, unknown>
    expect(noAgents["state"]).toBe("error")
    expect(noAgents["unguardedAgents"]).toEqual([])
    expect(noAgents["nextStep"]).toMatch(/OpenCode did not report its agents/)
  })

  test("probe answers the key's fingerprint, with no content", async () => {
    const handlers = createHandlers(deps())
    expect(await handlers["probe"]!.run({ source: "saved" }, call("personal"))).toEqual({ source: "saved", account: "personal", owner, trust: "untrusted" })
    await expect(handlers["probe"]!.run({ source: "gmail" }, call())).rejects.toMatchObject({ code: "SOURCE_UNKNOWN" })
  })

  test("events_list passes the account and the input to the feed", async () => {
    let seen: unknown
    const handlers = createHandlers(
      deps(
        fakeProvider({
          savedSearchPage: async (input, account) => {
            seen = { input, account }
            return { source: "saved", account, owner, events: [], cursor: "cursor", more: false, trust: "untrusted" }
          },
        }),
      ),
    )
    const input = { source: "saved", scope: { search: "5432" } }
    await handlers["events_list"]!.run(input, call("personal"))
    expect(seen).toEqual({ input, account: "personal" })
  })

  test("the own tools answer their shapes and their credit cost", async () => {
    const handlers = createHandlers(deps())
    expect(await handlers["search_companies"]!.run({ domains: ["hedgehog.example"] }, call("default"))).toEqual({
      resolved: [{ domain: "hedgehog.example", matches: [{ id: "hedgehog-co", name: "Hedgehog Labs" }] }],
      cost: { credits: 0 },
      trust: "untrusted",
    })
    const company = (await handlers["get_company"]!.run({ id: "hedgehog-co" }, call("default"))) as { company: { id: string }; cost: { credits: number } }
    expect(company.company.id).toBe("hedgehog-co")
    expect(company.cost.credits).toBe(1)
    expect(await handlers["list_saved_searches"]!.run({}, call("default"))).toEqual({ options: [{ id: SEARCHES.work, label: "Bristol software (company, 2 new, 2 total)" }] })
    const results = (await handlers["saved_search_results"]!.run({ searchId: SEARCHES.work }, call("default"))) as Record<string, unknown>
    expect(results).toMatchObject({ searchId: SEARCHES.work, page: 0, limit: 25, truncated: false, cost: { credits: 1 } })
  })
})

describe("the provider", () => {
  test("no team key is NEEDS_SIGN_IN, whose next step names the integration", async () => {
    const provider = createProvider({ key: async () => undefined, timeoutMs: 1000, fetch: async () => new Response("[]") })
    await expect(provider.resolveCompanies(["hedgehog.example"], signal)).rejects.toMatchObject({ code: "NEEDS_SIGN_IN" })
    await expect(provider.owner(signal)).rejects.toMatchObject({ code: "NEEDS_SIGN_IN" })
  })

  test("the owner is the key's fingerprint, and the team key is not an account", () => {
    expect(fingerprintOf(INVENTED_KEY)).toMatch(/^[0-9a-f]{16}$/)
    expect(ownerOf(fingerprintOf(INVENTED_KEY))).toEqual({ id: `specter:key:${fingerprintOf(INVENTED_KEY)}`, label: `Specter team key ${fingerprintOf(INVENTED_KEY).slice(0, 8)}` })
    expect(TEAM_INTEGRATION_ID).toBe("specter-team")
  })

  test("reads the saved-search results page and the free list through the provider", async () => {
    const provider = createProvider({
      key: async () => INVENTED_KEY,
      timeoutMs: 1000,
      fetch: async (url) =>
        new Response(JSON.stringify(url.includes("/results") ? [COMPANIES.hedgehog] : [{ id: 5432, name: "Bristol software", product_type: "company" }, { id: 9012, name: "Talent", product_type: "person" }]), {
          headers: { "content-type": "application/json" },
        }),
    })
    const page = await provider.savedSearchResults({ searchId: SEARCHES.work, page: 0, limit: 25 }, signal)
    expect(page.credits).toBe(1)
    expect(page.companies.map((company) => company.id)).toEqual(["hedgehog-co"])
    expect((await provider.listSavedSearches(signal)).map((option) => option.id)).toEqual(["5432"])
  })

  test("the saved-search page reads through the team key and the fixed clock", async () => {
    let headers: Record<string, string> = {}
    const provider = createProvider({
      key: async () => INVENTED_KEY,
      timeoutMs: 1000,
      fetch: async (_url, init) => {
        headers = (init.headers ?? {}) as Record<string, string>
        return new Response(JSON.stringify(SAVED[SEARCHES.work]), { headers: { "content-type": "application/json", date: "Fri, 20 Nov 2026 09:00:00 GMT" } })
      },
    })
    const page = await provider.savedSearchPage({ source: "saved", scope: { search: SEARCHES.work }, since: "2026-11-19T09:00:00Z" }, "work", signal)
    expect(page.events).toHaveLength(2)
    expect(page.cost).toEqual({ units: [{ per: "company", count: 2 }] })
    expect(headers[API_KEY_HEADER]).toBe(INVENTED_KEY)
  })
})
