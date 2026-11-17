import { describe, expect, it } from "vitest"
import {
  type Call,
  MAX_INLINE_BYTES,
} from "../../src/tool-spec.js"
import { READ_TOOL_CLASSES, RESULTS_MAX, SUGGEST_OPERATION, ownSpecs, resolvedOf } from "../../src/read-tools.js"
import { REST_BASE } from "../../src/constants.js"
import { DUMMY_KEY } from "./fake.js"

const CALL: Call = { sessionID: "ses_test", agent: "build", messageID: "msg_test", id: "call_test", signal: new AbortController().signal }

/** A fetch that answers once with `body`, recording what it was sent. */
function fakeFetch(body: unknown, status = 200, headers: Record<string, string> = {}) {
  const seen: { url: string; method: string; headers: Record<string, string>; body?: string }[] = []
  const fetch = async (url: string, init: RequestInit) => {
    seen.push({ url, method: init.method ?? "GET", headers: (init.headers ?? {}) as Record<string, string>, ...(typeof init.body === "string" ? { body: init.body } : {}) })
    return Response.json(body, { status, headers })
  }
  return { fetch, seen }
}

/** The specs with a key and one assertion recorder. */
function tools(options: { key?: string; fetch?: (url: string, init: RequestInit) => Promise<Response> } = {}) {
  const asserts: { action: string; resources: string[] }[] = []
  const specs = ownSpecs({
    key: async () => options.key ?? DUMMY_KEY,
    fetch: options.fetch ?? (async () => Response.json([])),
    timeoutMs: 5_000,
    assert: async (_call, action, resources = ["*"]) => void asserts.push({ action, resources: [...resources] }),
  })
  const spec = (name: string) => specs.find((entry) => entry.name === name)!
  return { specs, spec, asserts }
}

describe("the plugin's own Specter tools", () => {
  it("are the four the slice names, with a class each: reads free, credits spent", () => {
    expect(READ_TOOL_CLASSES).toEqual({ search_companies: "read", get_company: "spend", list_saved_searches: "read", saved_search_results: "spend" })
    expect(tools().specs.map((spec) => [spec.name, spec.action, spec.class])).toEqual([
      ["search_companies", "specter_search_companies", "read"],
      ["get_company", "specter_get_company", "spend"],
      ["list_saved_searches", "specter_list_saved_searches", "read"],
      ["saved_search_results", "specter_saved_search_results", "spend"],
    ])
  })

  it("search_companies resolves domains with the free Find-company-ID call, and keeps five matches a domain", async () => {
    const body = [
      { query: { domain: "hedgehog-analytics.example" }, matches: [{ id: "hedgehog", name: "Hedgehog Analytics", domain: "hedgehog-analytics.example", hq: { city: "London", country: "United Kingdom" }, founded_year: 2019, match_confidence: 1 }] },
      { query: { domain: "nothing.example" }, matches: [] },
    ]
    const { fetch, seen } = fakeFetch(body)
    const { spec, asserts } = tools({ fetch })
    const outcome = await spec("search_companies").run({ domains: ["hedgehog-analytics.example", "nothing.example"] }, CALL)
    expect(seen.map((request) => `${request.method} ${request.url}`)).toEqual([`POST ${REST_BASE}/companies/resolve`])
    expect(JSON.parse(seen[0]!.body!)).toEqual({ to_resolve: [{ domain: "hedgehog-analytics.example" }, { domain: "nothing.example" }] })
    expect(outcome.output).toMatchObject({ cost: { credits: 0 } })
    expect((outcome.output as { resolved: unknown[] }).resolved).toEqual([
      { domain: "hedgehog-analytics.example", matches: [{ id: "hedgehog", name: "Hedgehog Analytics", domain: "hedgehog-analytics.example", city: "London", country: "United Kingdom", foundedYear: 2019, confidence: 1 }] },
      { domain: "nothing.example", matches: [] },
    ])
    expect(asserts).toEqual([{ action: "specter_search_companies", resources: ["*"] }])
    // The key travels in the header the reference names, never in the URL.
    expect(seen[0]!.headers["X-API-Key"]).toBe(DUMMY_KEY)
    expect(seen[0]!.url).not.toContain(DUMMY_KEY)
  })

  it("keeps a resolve answer to five matches a domain, whatever the provider sends", () => {
    const matches = Array.from({ length: 9 }, (_, index) => ({ id: `company${index}`, name: `Company ${index}` }))
    expect(resolvedOf([{ query: { domain: "many.example" }, matches }], ["many.example"])[0]!.matches).toHaveLength(5)
  })

  it("get_company reads one profile by id, and says what it costs", async () => {
    const { fetch, seen } = fakeFetch({
      id: "hedgehog",
      organization_name: "Hedgehog Analytics",
      website: { domain: "hedgehog-analytics.example", url: "https://hedgehog-analytics.example" },
      hq: { city: "London", country: "United Kingdom" },
      employee_count: 39,
      industry: "Data & Analytics",
      funding: { total_funding_usd: 16600000, last_funding_type: "seed" },
      last_updated: "2026-11-01",
    })
    const { spec, asserts } = tools({ fetch })
    const outcome = await spec("get_company").run({ id: "hedgehog" }, CALL)
    expect(seen.map((request) => `${request.method} ${request.url}`)).toEqual([`GET ${REST_BASE}/companies/hedgehog`])
    expect(outcome.output).toMatchObject({
      company: { id: "hedgehog", name: "Hedgehog Analytics", domain: "hedgehog-analytics.example", city: "London", industry: "Data & Analytics", employeeCount: 39, totalFundingUsd: 16600000 },
      cost: { credits: 1 },
    })
    expect(asserts).toEqual([{ action: "specter_get_company", resources: ["*"] }])
  })

  it("refuses a company id that is not Specter's shape, before any request", async () => {
    const { fetch, seen } = fakeFetch({})
    const { spec } = tools({ fetch })
    await expect(spec("get_company").run({ id: "../../lists" }, CALL)).rejects.toThrow(/^INPUT_INVALID: /)
    expect(seen).toEqual([])
  })

  it("list_saved_searches reads the free list and asserts the operation the source binds at consent", async () => {
    const { fetch, seen } = fakeFetch([{ id: 5432, name: "Europe series A", product_type: "companies", query_id: "q_1", new_count: 4, full_count: 12, owner_id: "owner_1", is_global: false }])
    const { spec, asserts } = tools({ fetch })
    const outcome = await spec("list_saved_searches").run({ source: "specter.saved", account: "default" }, CALL)
    expect(seen.map((request) => `${request.method} ${request.url}`)).toEqual([`GET ${REST_BASE}/searches`])
    expect(outcome.output).toEqual({ options: [{ id: "5432", label: "Europe series A (companies, 4 new, 12 total)" }], cost: { credits: 0 } })
    // Its own action, then the operation the source's `scope.suggest` binds at consent.
    expect(asserts).toEqual([
      { action: "specter_list_saved_searches", resources: ["*"] },
      { action: "specter.read", resources: [`default:${SUGGEST_OPERATION}`] },
    ])
  })

  it("saved_search_results reads a page of a company search and charges a credit a company", async () => {
    const { fetch, seen } = fakeFetch([{ id: "hedgehog", organization_name: "Hedgehog Analytics" }, { id: "otter", organization_name: "Otter Labs" }])
    const { spec, asserts } = tools({ fetch })
    const outcome = await spec("saved_search_results").run({ searchId: "5432", newResultsAfter: "2026-11-08T00:00:00.000Z", page: 1, limit: 2 }, CALL)
    const url = new URL(seen[0]!.url)
    expect(`${seen[0]!.method} ${url.origin}${url.pathname}`).toBe(`GET ${REST_BASE}/searches/companies/5432/results`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ limit: "2", page: "1", new_results_after: "2026-11-08T00:00:00.000Z" })
    expect(outcome.output).toMatchObject({ searchId: "5432", page: 1, limit: 2, cost: { credits: 2 } })
    expect((outcome.output as { companies: { id: string }[] }).companies.map((company) => company.id)).toEqual(["hedgehog", "otter"])
    expect(asserts).toEqual([{ action: "specter_saved_search_results", resources: ["*"] }])
    expect(RESULTS_MAX).toBeGreaterThanOrEqual(100)
  })

  it("refuses a page bigger than the bound and a limit that is not a whole number", async () => {
    const { fetch, seen } = fakeFetch([])
    const { spec } = tools({ fetch })
    await expect(spec("saved_search_results").run({ searchId: "5432", limit: 5_000 }, CALL)).rejects.toThrow(/^INPUT_INVALID: /)
    await expect(spec("saved_search_results").run({ searchId: "5432", limit: 1.5 }, CALL)).rejects.toThrow(/^INPUT_INVALID: /)
    expect(seen).toEqual([])
  })

  it("asks for the team key at call time, and refuses with AUTH_REQUIRED when none is connected", async () => {
    const { fetch, seen } = fakeFetch([])
    let key: string | undefined
    const asserts: string[] = []
    const specs = ownSpecs({ key: async () => key, fetch, timeoutMs: 5_000, assert: async (_call, action) => void asserts.push(action) })
    const spec = specs.find((entry) => entry.name === "list_saved_searches")!
    await expect(spec.run({}, CALL)).rejects.toThrow(/^AUTH_REQUIRED: /)
    expect(seen).toEqual([])
    key = DUMMY_KEY
    await spec.run({}, CALL)
    expect(seen).toHaveLength(1)
  })

  it("maps Specter's failures with the plugin's error mapper: OUT_OF_CREDITS, the daily cap, a refused key", async () => {
    const cases: [number, string, string][] = [
      [402, "OUT_OF_CREDITS", "OUT_OF_CREDITS"],
      [402, "DAILY_CREDIT_CAP_REACHED", "DAILY_CREDIT_CAP_REACHED"],
      [401, "API_KEY_NOT_VALID", "KEY_REJECTED"],
    ]
    for (const [status, errorCode, code] of cases) {
      const { fetch } = fakeFetch({ errorCode, message: errorCode }, status, { date: new Date().toISOString() })
      const { spec } = tools({ fetch })
      await expect(spec("get_company").run({ id: "hedgehog" }, CALL)).rejects.toThrow(new RegExp(`^${code}: `))
    }
  })

  it("keeps a direct call's text under the inline cap", async () => {
    expect(MAX_INLINE_BYTES).toBe(100_000)
  })
})
