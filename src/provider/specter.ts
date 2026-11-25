// The Specter provider client: the REST calls behind every method, and the per-alias MCP server config the accounts module
// registers. This is the only module that names a URL or a header.
//
// Nothing here calls Specter at load time: each call reads the team key at call time and sends it only to the REST base.
// A call that may spend credits is never retried, so a retry cannot charge twice.
import type { Owner } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { EventsListResult } from "@we-the-rebel-alliance/plugin-contract/events"
import { createHash } from "node:crypto"
import {
  COMPANY_PRODUCTS,
  type CompanyRecord,
  type ResolvedDomain,
  type SavedSearchOption,
  companyOf,
  companiesOf,
  resolvedOf,
  savedSearchOption,
  searchesOf,
} from "./companies.js"
import { API_CONSOLE_URL, MCP_URL } from "./endpoints.js"
import { failureOf, keyAccepted, refuse } from "./errors.js"
import { type ApiOutput, type Fetch, type RestInput, request } from "./request.js"
import { type SourceAccess, listEvents } from "./saved.js"

/** What the provider needs from the plugin: the team key, the request settings and the clock. */
export interface ProviderDeps {
  /** The team key at call time; undefined when /connect has no key. */
  readonly key: () => Promise<string | undefined>
  /** The `requestTimeoutMs` option: one attempt's time limit. */
  readonly timeoutMs: number
  /** The fetch the request layer uses; the host's `fetch` unless a test points at a loopback fake. */
  readonly fetch?: Fetch
  /** The REST base; the provider's one address unless a test points at a loopback fake. */
  readonly base?: string
  /** The clock, for a page's observation time; Date.now in the plugin, fixed in the tests. */
  readonly now?: () => number
}

/** One saved-search results page, as the tool shows it. */
export interface ResultsPage {
  readonly searchId: string
  readonly page: number
  readonly limit: number
  readonly companies: readonly CompanyRecord[]
  /** True when Specter's answer was cut at the inline cap: the page is shorter than what was charged for. */
  readonly truncated: boolean
  /** What Specter charged: one credit per result it returned, counted before the cap. */
  readonly credits: number
}

/** The plugin's own tools and its saved-search feed, over one team key. */
export interface SpecterProvider {
  readonly resolveCompanies: (domains: readonly string[], signal: AbortSignal) => Promise<readonly ResolvedDomain[]>
  readonly getCompany: (id: string, signal: AbortSignal) => Promise<CompanyRecord>
  readonly listSavedSearches: (signal: AbortSignal) => Promise<readonly SavedSearchOption[]>
  readonly savedSearchResults: (input: { readonly searchId: string; readonly newResultsAfter?: string; readonly page: number; readonly limit: number }, signal: AbortSignal) => Promise<ResultsPage>
  readonly savedSearchPage: (input: unknown, account: string, signal: AbortSignal) => Promise<EventsListResult>
  readonly owner: (signal: AbortSignal) => Promise<Owner>
}

/** The team key's name in /connect. Distinct from the `specter` MCP server, which holds each person's own sign-in. */
export const TEAM_INTEGRATION_ID = "specter-team"
/** The label of the integration's one method, as /connect shows it. */
export const TEAM_KEY_LABEL = "Specter team API key"

/** The MCP server config for one account alias: Specter's own server, one sign-in per alias. */
export function mcpServerConfig(_name: string): { readonly type: "remote"; readonly url: string } {
  return { type: "remote", url: MCP_URL }
}

/** A key's fingerprint, for the owner id: SHA-256's first 16 hex digits, never the key itself. */
export function fingerprintOf(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16)
}

/** The owner a key names: `specter:key:<fingerprint>`, the key's SHA-256 prefix, never the key. */
export function ownerOf(fingerprint: string): Owner {
  const short = fingerprint.slice(0, 16)
  return { id: `specter:key:${short}`, label: `Specter team key ${short.slice(0, 8)}` }
}

/** The refusal for a call with no key connected: NEEDS_SIGN_IN, whose next step names /connect. */
function signedOut(): never {
  refuse("NEEDS_SIGN_IN", "No Specter team API key is connected", `Run /connect, choose "${TEAM_KEY_LABEL}" and paste the team key from Specter's API Console (${API_CONSOLE_URL}), then try again.`)
}

export function createProvider(deps: ProviderDeps): SpecterProvider {
  const now = deps.now ?? Date.now
  const fetcher = deps.fetch ?? fetch

  const send = async (key: string, input: RestInput, signal: AbortSignal): Promise<ApiOutput> => {
    const answer = await request(input, {
      key,
      fetch: fetcher,
      timeoutMs: deps.timeoutMs,
      signal,
      ...(deps.base === undefined ? {} : { base: deps.base }),
    })
    if (!answer.ok) throw failureOf(answer)
    return answer
  }

  /** The free balance read: a 402 is a valid key whose credits are spent, so it still names the owner. */
  const readOwner = async (key: string, signal: AbortSignal): Promise<Owner> => {
    const answer = await request({ method: "GET", path: "/organization/credits", retry: "free" }, { key, fetch: fetcher, timeoutMs: deps.timeoutMs, signal, ...(deps.base === undefined ? {} : { base: deps.base }) })
    if (!keyAccepted(answer)) throw failureOf(answer)
    return ownerOf(fingerprintOf(key))
  }

  /** The key, a read bound to it, and the owner it names; no network beyond the call the method makes. */
  const open = async (signal: AbortSignal): Promise<SourceAccess> => {
    const key = await deps.key()
    if (key === undefined) signedOut()
    return { read: (input) => send(key, input, signal), owner: ownerOf(fingerprintOf(key)) }
  }

  return {
    async resolveCompanies(domains, signal) {
      const key = await deps.key()
      if (key === undefined) signedOut()
      const answer = await send(
        key,
        { method: "POST", path: "/companies/resolve", body: { to_resolve: domains.map((domain) => ({ domain })) }, retry: "free" },
        signal,
      )
      return resolvedOf(answer.data, domains)
    },

    async getCompany(id, signal) {
      const key = await deps.key()
      if (key === undefined) signedOut()
      const answer = await send(key, { method: "GET", path: `/companies/${id}`, retry: "never" }, signal)
      const company = companyOf(answer.data)
      if (company === undefined) {
        refuse("UNAVAILABLE", "Specter answered with a body that is not the company record its reference documents", "Try again; if it keeps happening, Specter's API has changed and the plugin needs an update.")
      }
      return company
    },

    async listSavedSearches(signal) {
      const key = await deps.key()
      if (key === undefined) signedOut()
      const answer = await send(key, { method: "GET", path: "/searches", retry: "free" }, signal)
      // Only company searches are offered: this is `specter.saved`'s scope suggest, and that source reads companies.
      const seen = new Set<string>()
      return searchesOf(answer.data)
        .filter((search) => search.product_type === undefined || COMPANY_PRODUCTS.has(search.product_type))
        .map(savedSearchOption)
        .filter((option) => (seen.has(option.id) ? false : (seen.add(option.id), true)))
        .slice(0, 64)
    },

    async savedSearchResults(input, signal) {
      const key = await deps.key()
      if (key === undefined) signedOut()
      const answer = await send(
        key,
        {
          method: "GET",
          path: `/searches/companies/${input.searchId}/results`,
          query: {
            limit: input.limit,
            page: input.page,
            ...(input.newResultsAfter === undefined ? {} : { new_results_after: input.newResultsAfter }),
          },
          retry: "never",
        },
        signal,
      )
      const records = companiesOf(answer.data)
      return { searchId: input.searchId, page: input.page, limit: input.limit, companies: records, truncated: answer.truncated, credits: answer.itemsReturned ?? records.length }
    },

    async savedSearchPage(input, account, signal) {
      const held: SourceAccess = await open(signal)
      return listEvents(input, {
        open: async () => held,
        now: now(),
        account,
      })
    },

    async owner(signal) {
      const key = await deps.key()
      if (key === undefined) signedOut()
      return readOwner(key, signal)
    },
  }
}
