// A recorded stand-in for Specter's REST API, answering exactly what the public API reference documents for the four
// endpoints this plugin calls, from invented data (test/fixtures/sources.json): no network, no key, no Specter.
//
// `added` is this fixture's stand-in for the moment Specter added a company to the search, which its records do not
// carry: the results endpoint filters on it (`new_results_after` is inclusive), exactly as Specter's reference says
// the cutoff works, so the cursor's boundary behaviour is exercised for real.
import { readFileSync } from "node:fs"
import type { ApiOutput, RestInput } from "../../src/api/request.js"
import type { Read } from "../../src/source/saved.js"

export interface FixtureCompany {
  readonly id: string
  readonly added: string
  readonly organization_name?: string
  readonly website?: { readonly domain?: string; readonly url?: string }
  readonly hq?: { readonly city?: string; readonly country?: string }
  readonly employee_count?: number
  readonly industry?: string
  readonly last_updated?: string
}

export interface Fixture {
  readonly now: string
  readonly search: string
  readonly searches: readonly Record<string, unknown>[]
  readonly credits: Record<string, unknown>
  readonly companies: readonly FixtureCompany[]
}

export const FIXTURE = JSON.parse(readFileSync(new URL("../fixtures/sources.json", import.meta.url), "utf8")) as Fixture

/** The API's own base, as the plugin addresses it; a fake fetch or a `Read` sees the same paths. */
export const REST_PATH = "/api/v1"

/** An answer that succeeded, with the server's `Date` header as Specter's would carry it. */
const ok = (data: unknown, at: string): ApiOutput => ({ ok: true, status: 200, data, truncated: false, attempts: 1, serverTime: at, trust: { specterContent: "untrusted" } })

/** An answer that failed: Specter's `{ errorCode, message }` and the headers it documents for 402 and 429. */
export function failure(status: number, errorCode: string, headers: { readonly creditsReset?: number; readonly rateReset?: number } = {}, at = FIXTURE.now): ApiOutput {
  return {
    ok: false,
    status,
    data: { errorCode, message: errorCode },
    contentType: "application/json",
    truncated: false,
    ...(headers.rateReset === undefined ? {} : { rateLimit: { limit: 15, remaining: 0, resetSeconds: headers.rateReset } }),
    ...(headers.creditsReset === undefined ? {} : { credits: { limit: 1000, remaining: 0, resetSeconds: headers.creditsReset } }),
    error: { code: "UPSTREAM_ERROR", message: errorCode, errorCode },
    nextStep: "Try again later.",
    attempts: 1,
    serverTime: at,
    trust: { specterContent: "untrusted" },
  }
}

export interface Provider extends Read {
  /** Every call the source made, in order. */
  readonly calls: RestInput[]
  /** The clock the provider's `Date` header carries: what Specter's server time advances to. */
  now(): number
  advance(ms: number): void
  /** What a provider answer should be instead of the documented one, for a failure a test needs. */
  failNext(answer: ApiOutput | undefined): void
  /** Companies the provider holds, to add one between reads. */
  readonly companies: FixtureCompany[]
}

/**
 * The provider: Specter's answers for the paths this plugin uses. `searchId`, `new_results_after`, `page` and `limit`
 * behave as the reference describes them, including the inclusive cutoff and 404 for an unknown search.
 */
export function provider(fixture: Fixture = FIXTURE): Provider {
  const calls: RestInput[] = []
  const companies = fixture.companies.map((company) => ({ ...company }))
  let clock = Date.parse(fixture.now)
  let next: ApiOutput | undefined
  const at = () => new Date(clock).toISOString()
  const read = (async (input: RestInput): Promise<ApiOutput> => {
    calls.push(input)
    if (next !== undefined) {
      const answer = next
      next = undefined
      return answer
    }
    const path = input.path
    if (path === "/organization/credits" && input.method === "GET") return ok(fixture.credits, at())
    if (path === "/searches" && input.method === "GET") return ok(fixture.searches, at())
    if (path === "/companies/resolve" && input.method === "POST") {
      const body = input.body as { to_resolve?: { domain?: string }[] } | undefined
      const groups = (body?.to_resolve ?? []).map((item) => {
        const domain = item.domain ?? ""
        const match = companies.find((company) => company.website?.domain === domain)
        return {
          query: { domain },
          matches: match === undefined ? [] : [{ id: match.id, name: match.organization_name, domain, hq: match.hq ?? {}, founded_year: 2019, match_confidence: 1 }],
        }
      })
      return ok(groups, at())
    }
    const company = /^\/companies\/([A-Za-z0-9_-]{4,64})$/.exec(path)
    if (company !== null && input.method === "GET") {
      const found = companies.find((item) => item.id === company[1])
      return found === undefined ? failure(404, "NOT_FOUND") : ok(found, at())
    }
    const results = /^\/searches\/([a-z-]+)\/([0-9]{1,20})\/results$/.exec(path)
    if (results !== null && input.method === "GET") {
      if (results[2] !== fixture.search) return failure(404, "NOT_FOUND")
      if (results[1] !== "companies") return failure(400, "NOT_SUPPORTED_PRODUCT")
      const query = input.query ?? {}
      const after = typeof query["new_results_after"] === "string" ? Date.parse(query["new_results_after"]) : -Infinity
      const page = Number(query["page"] ?? 0)
      const limit = Number(query["limit"] ?? 50)
      const matching = companies.filter((item) => Date.parse(item.added) >= after)
      return ok(matching.slice(page * limit, page * limit + limit), at())
    }
    return failure(404, "NOT_FOUND")
  }) as unknown as Provider
  Object.defineProperties(read, {
    calls: { value: calls },
    companies: { value: companies },
    now: { value: () => clock },
    advance: { value: (ms: number) => void (clock += ms) },
    failNext: { value: (answer: ApiOutput | undefined) => void (next = answer) },
  })
  return read
}
