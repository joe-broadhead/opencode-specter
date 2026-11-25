// Specter's company and saved-search records, checked and cut to the fields the plugin reads. Pure: every function here
// answers from a body a test can invent, and no function calls Specter.
//
// The provider facts come from Specter's public API reference, recorded on 2026-11-17, and are not yet confirmed against
// live responses:
//
// - `POST /companies/resolve` finds company IDs from domains. Free.
// - `GET /companies/{id}` is the full company record. Charged 1 credit per result returned; a miss costs nothing.
// - `GET /searches` lists every saved search shared with the API. Free.
// - `GET /searches/companies/{searchId}/results` is a saved company search's matches, page by page. Charged 1 credit per
//   result returned.
import { refuse } from "./errors.js"

/** The company fields a result record holds, as much as this plugin reads. */
export interface CompanyRecord {
  readonly id: string
  readonly organization_name?: string
  readonly website?: { readonly domain?: string; readonly url?: string }
  readonly hq?: { readonly city?: string; readonly country?: string }
  readonly employee_count?: number
  readonly employee_count_range?: string
  readonly founded_year?: number
  readonly industry?: string
  readonly growth_stage?: string
  readonly description?: string
  readonly funding?: { readonly total_funding_usd?: number; readonly last_funding_type?: string }
  readonly last_updated?: string
}

/** A saved search, as `GET /searches` lists it. */
export interface SavedSearch {
  readonly id: number
  readonly name?: string
  readonly product_type?: string
  readonly query_id?: string
  readonly new_count?: number
  readonly full_count?: number
  readonly owner_id?: string
  readonly is_global?: boolean
}

/** One saved search as the scope-suggest answer shows it: the contract's `{ id, label }` shape. */
export interface SavedSearchOption {
  readonly id: string
  readonly label: string
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined)
const whole = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined)
/** `founded_year` is an integer or, the reference says, a string: both are read. */
const year = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value === "string" && /^\d{4}$/.test(value.trim())) return Number(value.trim())
  return undefined
}
/** `industry` is an array, a string or null, the reference says: kept as one line. */
const industries = (value: unknown): string | undefined => {
  if (typeof value === "string") return text(value, 120)
  if (!Array.isArray(value)) return undefined
  const names = value.flatMap((item) => (typeof item === "string" && item.trim() !== "" ? [item.trim()] : []))
  return names.length === 0 ? undefined : names.join(", ").slice(0, 120)
}

/** A company's id, as Specter writes it: letters, digits, `_` and `-`. */
export const COMPANY_ID = /^[A-Za-z0-9_-]{4,64}$/
/** A saved search's id: Specter's `searchId` is an integer, and anything else is 422 there. */
export const SEARCH_ID = /^[0-9]{1,20}$/
/** The product types that are a company search: Specter's reference spells it `company`, and `companies` is accepted. */
export const COMPANY_PRODUCTS: ReadonlySet<string> = new Set(["company", "companies"])

/** One company record, checked and cut to the fields this plugin reads. Undefined when it names no usable id. */
export function companyOf(value: unknown): CompanyRecord | undefined {
  if (!record(value)) return undefined
  const id = text(value["id"], 64)
  if (id === undefined || !COMPANY_ID.test(id)) return undefined
  const website = record(value["website"]) ? { domain: text(value["website"]["domain"], 253), url: text(value["website"]["url"], 2048) } : undefined
  const hq = record(value["hq"]) ? { city: text(value["hq"]["city"], 120), country: text(value["hq"]["country"], 120) } : undefined
  const funding = record(value["funding"]) ? { total_funding_usd: whole(value["funding"]["total_funding_usd"]), last_funding_type: text(value["funding"]["last_funding_type"], 40) } : undefined
  const industry = industries(value["industry"])
  return {
    id,
    ...(text(value["organization_name"], 300) === undefined ? {} : { organization_name: text(value["organization_name"], 300) }),
    ...(website ? { website } : {}),
    ...(hq ? { hq } : {}),
    ...(whole(value["employee_count"]) === undefined ? {} : { employee_count: whole(value["employee_count"]) }),
    ...(text(value["employee_count_range"], 40) === undefined ? {} : { employee_count_range: text(value["employee_count_range"], 40) }),
    ...(year(value["founded_year"]) === undefined ? {} : { founded_year: year(value["founded_year"]) }),
    ...(industry === undefined ? {} : { industry }),
    ...(text(value["growth_stage"], 80) === undefined ? {} : { growth_stage: text(value["growth_stage"], 80) }),
    ...(text(value["description"], 1000) === undefined ? {} : { description: text(value["description"], 1000) }),
    ...(funding ? { funding } : {}),
    ...(text(value["last_updated"], 40) === undefined ? {} : { last_updated: text(value["last_updated"], 40) }),
  }
}

/**
 * The companies in one results answer. A body that is not an array, or an item the plugin does not recognise, fails the
 * whole page: a page that dropped an item would lose history and still be charged for it.
 */
export function companiesOf(data: unknown): CompanyRecord[] {
  if (!Array.isArray(data)) {
    refuse("UNAVAILABLE", "Specter's saved-search results answer is not the array of companies its reference documents", "Try again; if it keeps happening, Specter's API has changed and the plugin needs an update.")
  }
  return data.map((item) => {
    const company = companyOf(item)
    if (company === undefined) {
      refuse("UNAVAILABLE", "Specter's saved-search results held a company record this plugin does not recognise, so the page cannot be listed without losing it", "Try again; if it keeps happening, Specter's API has changed and the plugin needs an update.")
    }
    return company
  })
}

/** The saved searches in a `GET /searches` answer: an array, or an object holding one under `items`. */
export function searchesOf(data: unknown): SavedSearch[] {
  const list = Array.isArray(data) ? data : record(data) && Array.isArray(data["items"]) ? data["items"] : undefined
  if (list === undefined) {
    refuse("UNAVAILABLE", "Specter's saved-search list is not the array its reference documents", "Try again; if it keeps happening, Specter's API has changed and the plugin needs an update.")
  }
  return list.flatMap((item): SavedSearch[] => {
    if (!record(item)) return []
    const raw = item["id"]
    const id = typeof raw === "number" ? raw : typeof raw === "string" && SEARCH_ID.test(raw) ? Number(raw) : undefined
    if (id === undefined || !Number.isSafeInteger(id) || id < 0) return []
    return [
      {
        id,
        ...(text(item["name"], 200) === undefined ? {} : { name: text(item["name"], 200) }),
        ...(text(item["product_type"], 40) === undefined ? {} : { product_type: text(item["product_type"], 40) }),
        ...(text(item["query_id"], 64) === undefined ? {} : { query_id: text(item["query_id"], 64) }),
        ...(whole(item["new_count"]) === undefined ? {} : { new_count: whole(item["new_count"]) }),
        ...(whole(item["full_count"]) === undefined ? {} : { full_count: whole(item["full_count"]) }),
        ...(text(item["owner_id"], 64) === undefined ? {} : { owner_id: text(item["owner_id"], 64) }),
        ...(typeof item["is_global"] === "boolean" ? { is_global: item["is_global"] } : {}),
      },
    ]
  })
}

/**
 * One saved search as `{ id, label }`: the contract's `scope.suggest` shape, so a consumer can offer the person their
 * searches at consent and an agent can find the id a read needs. The label carries what tells two searches apart: the
 * product, and the counts Specter reports.
 */
export function savedSearchOption(search: SavedSearch): SavedSearchOption {
  const name = (search.name ?? "Untitled search").slice(0, 160)
  const facts = [search.product_type ?? "unknown product"]
  if (search.new_count !== undefined) facts.push(`${search.new_count} new`)
  if (search.full_count !== undefined) facts.push(`${search.full_count} total`)
  return { id: String(search.id), label: `${name} (${facts.join(", ")})`.slice(0, 200) }
}

/** One company as a tool shows it: the fields this plugin reads, camel-cased, and nothing else. */
export interface CompanyView {
  readonly id: string
  readonly name?: string
  readonly domain?: string
  readonly website?: string
  readonly city?: string
  readonly country?: string
  readonly industry?: string
  readonly growthStage?: string
  readonly employeeCount?: number
  readonly employeeCountRange?: string
  readonly foundedYear?: number
  readonly totalFundingUsd?: number
  readonly lastFundingType?: string
  readonly lastUpdated?: string
  readonly description?: string
}

export function companyView(company: CompanyRecord): CompanyView {
  return {
    id: company.id,
    ...(company.organization_name === undefined ? {} : { name: company.organization_name }),
    ...(company.website?.domain === undefined ? {} : { domain: company.website.domain }),
    ...(company.website?.url === undefined ? {} : { website: company.website.url }),
    ...(company.hq?.city === undefined ? {} : { city: company.hq.city }),
    ...(company.hq?.country === undefined ? {} : { country: company.hq.country }),
    ...(company.industry === undefined ? {} : { industry: company.industry }),
    ...(company.growth_stage === undefined ? {} : { growthStage: company.growth_stage }),
    ...(company.employee_count === undefined ? {} : { employeeCount: company.employee_count }),
    ...(company.employee_count_range === undefined ? {} : { employeeCountRange: company.employee_count_range }),
    ...(company.founded_year === undefined ? {} : { foundedYear: company.founded_year }),
    ...(company.funding?.total_funding_usd === undefined ? {} : { totalFundingUsd: company.funding.total_funding_usd }),
    ...(company.funding?.last_funding_type === undefined ? {} : { lastFundingType: company.funding.last_funding_type }),
    ...(company.last_updated === undefined ? {} : { lastUpdated: company.last_updated }),
    ...(company.description === undefined ? {} : { description: company.description }),
  }
}

/** One match from the free Find-company-ID call. */
export interface ResolveMatch {
  readonly id: string
  readonly name?: string
  readonly domain?: string
  readonly city?: string
  readonly country?: string
  readonly foundedYear?: number
  readonly confidence?: number
}

/** One domain's matches, in the order the domains were sent. */
export interface ResolvedDomain {
  readonly domain: string
  readonly matches: readonly ResolveMatch[]
}

/** Matches kept per domain: a resolver answers a handful, and a page of them is not a list. */
const RESOLVE_MATCHES = 5

/**
 * What one resolve answer holds: one result group per identifier sent, **in the order they were sent**, which is what
 * Specter's reference documents. A group is matched by its position, not by the `query` it echoes, because that echo is
 * the *normalized* identifier (a `www.` prefix or a case difference would never match) — and a body that is not an array
 * is refused rather than answered as "nothing found".
 */
export function resolvedOf(data: unknown, domains: readonly string[]): ResolvedDomain[] {
  if (!Array.isArray(data)) {
    refuse("UNAVAILABLE", "Specter's Find-company-ID answer is not the array of result groups its reference documents", "Try again; if it keeps happening, Specter's API has changed and the plugin needs an update.")
  }
  if (data.length !== domains.length) {
    refuse("UNAVAILABLE", `Specter answered ${data.length} result group${data.length === 1 ? "" : "s"} for ${domains.length} domain${domains.length === 1 ? "" : "s"}`, "Try again with fewer domains; if it keeps happening, Specter's API has changed and the plugin needs an update.")
  }
  return domains.map((domain, index) => {
    const group = record(data[index]) ? data[index] : {}
    const matches = Array.isArray(group["matches"]) ? group["matches"] : []
    return {
      domain,
      matches: matches
        .flatMap((item): ResolveMatch[] => {
          const held = record(item) ? item : undefined
          const id = held?.["id"]
          if (typeof id !== "string" || !COMPANY_ID.test(id)) return []
          const hq = record(held?.["hq"]) ? held["hq"] : undefined
          const named = (value: unknown) => (typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, 200) : undefined)
          return [
            {
              id,
              ...(named(held?.["name"]) === undefined ? {} : { name: named(held?.["name"]) }),
              ...(named(held?.["domain"]) === undefined ? {} : { domain: named(held?.["domain"]) }),
              ...(named(hq?.["city"]) === undefined ? {} : { city: named(hq?.["city"]) }),
              ...(named(hq?.["country"]) === undefined ? {} : { country: named(hq?.["country"]) }),
              ...(typeof held?.["founded_year"] === "number" ? { foundedYear: Math.floor(held["founded_year"] as number) } : {}),
              ...(typeof held?.["match_confidence"] === "number" ? { confidence: held["match_confidence"] as number } : {}),
            },
          ]
        })
        .slice(0, RESOLVE_MATCHES),
    }
  })
}
