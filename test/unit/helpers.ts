// Invented Specter answers and a fake read for the unit and fixture-replay tests. Every company, search, key and id is
// invented; no test calls Specter.
import type { ApiOutput, RestInput } from "../../src/provider/request.js"
import type { Read } from "../../src/provider/saved.js"

/** An invented team key: never a real one, and not credential-shaped. */
export const INVENTED_KEY = "invented-team-key-0001"
/** The fixed clock every recording uses, so the fixture is deterministic. */
export const FIXED_NOW = Date.parse("2026-11-20T09:00:00.000Z")
/** Specter's `Date` header in the fake answers, the page's observation time. */
export const SERVER_TIME = "2026-11-20T09:00:00.000Z"

/** The two saved searches the invented team can read. */
export const SEARCHES = {
  work: "5432",
  personal: "7788",
} as const

export const COMPANIES = {
  hedgehog: {
    id: "hedgehog-co",
    organization_name: "Hedgehog Labs",
    website: { domain: "hedgehog.example", url: "https://hedgehog.example" },
    hq: { city: "Bristol", country: "GB" },
    employee_count: 42,
    employee_count_range: "11-50",
    founded_year: 2019,
    industry: ["Software"],
    growth_stage: "seed",
    description: "A company that tests the saved-search feed.",
    funding: { total_funding_usd: 1_000_000, last_funding_type: "seed" },
    last_updated: "2026-11-01",
  },
  otter: {
    id: "otter-co",
    organization_name: "Otter & Co",
    website: { domain: "otter.example" },
    hq: { city: "Lisbon", country: "PT" },
    employee_count: 120,
    founded_year: 2017,
    industry: "Software",
    last_updated: "2026-11-02",
  },
  badger: {
    id: "badger-co",
    organization_name: "Badger Works",
    hq: { city: "Oslo", country: "NO" },
    employee_count: 8,
    founded_year: 2021,
    industry: ["Design"],
  },
} as const

/** The saved searches as `GET /searches` lists them. */
export const SEARCH_LIST = [
  { id: 5432, name: "Bristol software", product_type: "company", new_count: 2, full_count: 2 },
  { id: 7788, name: "Nordic design", product_type: "company", new_count: 1, full_count: 1 },
  { id: 9012, name: "Talent", product_type: "person", new_count: 0, full_count: 4 },
]

/** The resolve answer for hedgehog.example, in Specter's order-of-domains shape. */
export const RESOLVE = [{ matches: [{ id: "hedgehog-co", name: "Hedgehog Labs", domain: "hedgehog.example", hq: { city: "Bristol", country: "GB" }, founded_year: 2019, match_confidence: 0.98 }] }]

/** One successful answer body with Specter's `Date` header. */
export function answer(data: unknown, itemsReturned?: number): ApiOutput {
  return {
    ok: true,
    status: 200,
    data,
    truncated: false,
    ...(itemsReturned === undefined ? {} : { itemsReturned }),
    serverTime: SERVER_TIME,
    attempts: 1,
    trust: { specterContent: "untrusted" },
  }
}

/** The companies one saved search returns, by the search id. */
export const SAVED = {
  [SEARCHES.work]: [COMPANIES.hedgehog, COMPANIES.otter],
  [SEARCHES.personal]: [COMPANIES.badger],
} as const

/** A read that answers the saved-search results and the credit balance from the invented data. */
export function savedRead(onRead?: (input: RestInput) => void): Read {
  return async (input) => {
    onRead?.(input)
    const results = /^\/searches\/companies\/([0-9]+)\/results$/.exec(input.path)
    if (results !== null) {
      const companies = SAVED[results[1] as keyof typeof SAVED] ?? []
      return answer(companies, companies.length)
    }
    if (input.path === "/organization/credits") return answer({ credits_remaining: 100 })
    throw new Error(`the fake does not answer ${input.method} ${input.path}`)
  }
}
