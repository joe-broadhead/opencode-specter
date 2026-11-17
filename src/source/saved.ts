/**
 * `specter.saved`: the companies Specter added to one saved **company** search since a cursor, as source-contract
 * events. Pure: every read is an injected `Read`, so the conformance kit and the unit tests answer from fixtures and
 * no test calls Specter.
 *
 * The provider facts below are from Specter's public API reference, recorded 2026-11-17, and are **not yet confirmed
 * against live responses** (no key has been used):
 *
 * - `GET /searches/companies/{searchId}/results?new_results_after=<ISO>&page=<0..>&limit=<1..5000>` returns the
 *   companies matching a saved company search (https://api.tryspecter.com/api-reference/company-saved-searches/
 *   get-company-saved-search-results.md). `new_results_after` returns "only the companies added to the search since
 *   then — pass back the timestamp of your last read to poll for what is new"; it "must be within the last 60 days",
 *   and an older one answers 422 `NEW_RESULTS_AFTER_BEYOND_RETENTION`.
 * - The call costs **1 credit per result returned**; a 4xx or 5xx is not charged
 *   (https://api.tryspecter.com/api-ref/rate_limits.md, https://api.tryspecter.com/api-ref/errors.md).
 * - A `searchId` that is not a number answers 422; an unknown or unshared search answers 404; a search of another
 *   product answers 400 `NOT_SUPPORTED_PRODUCT`.
 * - Result records carry **no "added to the search at" time** (the `CompanyV1Response` schema lists `last_updated` and
 *   no addition field), and the order of results under `new_results_after` is undocumented. So an event's
 *   `occurred_at` is the **read's observation time** — the moment the page that first listed the company was answered
 *   — never the company's own `last_updated`, which is not when it became visible. `docs/costs.md` and the skill say
 *   so too.
 * - `GET /searches` lists every saved search shared with the API (id, name, product_type, query_id, new_count,
 *   full_count, owner_id, is_global) and is free; it is this source's `scope.suggest` and the plugin's own
 *   `list_saved_searches` tool.
 *
 * The cursor is this source's own, bound to the plugin, the source, the account and the search (`cursor`):
 *
 * - `w` is the **watermark**: the `new_results_after` cutoff of the window being read. It is a *server* time when the
 *   answer carries a `Date` header (HTTP requires one, and Specter's server clock is the one that stamps additions),
 *   else the plugin's clock at the read. A cursor never moves it backwards, and a gap never recomputes it from "now":
 *   the page that answers a gap carries the restart line it chose, so a consumer that retries gets the same window.
 * - `p` is the **page** within that window. Specter pages by offset over a set that grows while you page, so the
 *   watermark is fixed for the whole window and only the page advances: a burst of companies added at one instant
 *   larger than a page drains page by page and never jams. When a page comes back short the window is done, the
 *   watermark moves to that page's observation time, and `p` returns to 0.
 * - `b` is the **boundary**: up to `BOUNDARY_IDS` company ids from the page just listed, dropped if the next read
 *   meets them again. Specter's cutoff is inclusive ("on or after"), so a company added at exactly the new watermark
 *   would be listed twice; carrying the ids also covers a page that had to be cut for size, which is resumed with the
 *   same page and the ids already listed. The cap is honest: a page holds at most `MAX_PAGE` companies, which is
 *   `BOUNDARY_IDS`, so every id of a page is carried.
 * - `g` records the lost window when a gap was answered (`gap.reason: "expired"`, `since` = the watermark that aged
 *   out). It is informational: the restart line is `w`, and no later page of the window repeats the gap. The restart
 *   line is the stale watermark plus Specter's window, not "now", so a retried gap read cannot slide it forward; only
 *   a cursor older than twice the window restarts at the window's edge, because nothing earlier can be read at all.
 */
import { type CursorBinding, decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import {
  type EventsCost,
  type EventsListResult,
  type EventsOwner,
  type ProbeResult,
  type SourceEvent,
  SourceError,
  eventsListResult,
  fitPage,
  makeEvent,
  parseEventsListInput,
  parseProbeInput,
  probeResult,
  screenEvents,
  startTime,
} from "@we-the-rebel-alliance/source-contract/events"
import type { ApiOutput, RestInput } from "../api/request.js"

/** The plugin's package name: every page names it. */
export const PACKAGE = "@joe-broadhead/opencode-specter"
/** The source's name, the `source` input the descriptor gives it. */
export const SOURCE = "saved"
/** The descriptor's id for it. */
export const SOURCE_ID = "specter.saved"
/** The scope key a person confirms: the saved company search's id. */
export const SCOPE_KEY = "search"
/** One team key, so one account; the family's name for a source that names none. */
export const ACCOUNT = "default"
/** The most bytes of JSON one page holds: the descriptor's `maxBytes`, the host's RPC cap. */
export const MAX_BYTES = 65_536
/** The most companies one page carries: a bound on the answer, and on the ids the cursor carries. */
export const MAX_PAGE = 25
/** Specter tracks additions to a saved search for 60 days; an older cutoff answers 422 rather than a partial answer. */
export const RETENTION_DAYS = 60
const RETENTION_MS = RETENTION_DAYS * 86_400_000
/** How far inside Specter's window a restart line sits, so clock skew between the two never asks for the very edge. */
const RESTART_GRACE_MS = 3_600_000
/** Company ids carried across the page boundary; `MAX_PAGE`, so a whole page fits. */
export const BOUNDARY_IDS = 25
/** The event kind: a company Specter added to a saved search. No core kind fits. */
export const EVENT_KIND = "x-specter/company"
/** The prefix of every `external_id`, so an id says what it is. */
export const EXTERNAL_PREFIX = "company:"

/** One REST read, as the plugin's request layer sends it; a fixture answers it in the tests. */
export type Read = (input: RestInput) => Promise<ApiOutput>

/** What one call needs: the read bound to the team key, and the owner the key names. */
export interface SourceAccess {
  readonly read: Read
  readonly owner: EventsOwner
}

/** The company fields a result record holds, as much as this source reads. */
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

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)
const text = (value: unknown, max: number): string | undefined => (typeof value === "string" && value.trim() !== "" ? value.trim().slice(0, max) : undefined)
const whole = (value: unknown): number | undefined => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : undefined)

/** A company's id, as Specter writes it: letters, digits, `_` and `-`. A path segment never carries anything else. */
export const COMPANY_ID = /^[A-Za-z0-9_-]{4,64}$/
/** A saved search's id: Specter's `searchId` is an integer, and anything else is 422 there. */
export const SEARCH_ID = /^[0-9]{1,20}$/

export function refuse(code: string, what: string, next: string, extra: { readonly retryAfterSec?: number; readonly gap?: { readonly reason: "expired" | "window-truncated"; readonly since: string } } = {}): never {
  throw new SourceError({ code, what, next, ...extra })
}

/** One company record, checked and cut to the fields this source reads. Undefined when it names no usable id. */
export function companyOf(value: unknown): CompanyRecord | undefined {
  if (!record(value)) return undefined
  const id = text(value["id"], 64)
  if (id === undefined || !COMPANY_ID.test(id)) return undefined
  const website = record(value["website"]) ? { domain: text(value["website"]["domain"], 253), url: text(value["website"]["url"], 2048) } : undefined
  const hq = record(value["hq"]) ? { city: text(value["hq"]["city"], 120), country: text(value["hq"]["country"], 120) } : undefined
  const funding = record(value["funding"]) ? { total_funding_usd: whole(value["funding"]["total_funding_usd"]), last_funding_type: text(value["funding"]["last_funding_type"], 40) } : undefined
  return {
    id,
    organization_name: text(value["organization_name"], 300),
    ...(website ? { website } : {}),
    ...(hq ? { hq } : {}),
    employee_count: whole(value["employee_count"]),
    employee_count_range: text(value["employee_count_range"], 40),
    founded_year: whole(value["founded_year"]),
    industry: text(value["industry"], 120),
    growth_stage: text(value["growth_stage"], 80),
    description: text(value["description"], 1000),
    ...(funding ? { funding } : {}),
    last_updated: text(value["last_updated"], 40),
  }
}

/** The companies in one results answer; a body that is not an array of records is SCHEMA_VIOLATION. */
export function companiesOf(data: unknown): CompanyRecord[] {
  if (!Array.isArray(data)) {
    refuse("SCHEMA_VIOLATION", "Specter's saved-search results answer is not the array of companies its reference documents", "Try again; if it keeps happening, Specter's API has changed and the plugin needs an update.")
  }
  return data.flatMap((item) => {
    const company = companyOf(item)
    return company === undefined ? [] : [company]
  })
}

/** The saved searches in a `GET /searches` answer: an array, or an object holding one under `items`. */
export function searchesOf(data: unknown): SavedSearch[] {
  const list = Array.isArray(data) ? data : record(data) && Array.isArray(data["items"]) ? data["items"] : undefined
  if (list === undefined) {
    refuse("SCHEMA_VIOLATION", "Specter's saved-search list is not the array its reference documents", "Try again; if it keeps happening, Specter's API has changed and the plugin needs an update.")
  }
  return list.flatMap((item): SavedSearch[] => {
    if (!record(item)) return []
    const raw = item["id"]
    const id = typeof raw === "number" ? raw : typeof raw === "string" && SEARCH_ID.test(raw) ? Number(raw) : undefined
    if (id === undefined || !Number.isSafeInteger(id) || id < 0) return []
    return [
      {
        id,
        name: text(item["name"], 200),
        product_type: text(item["product_type"], 40),
        query_id: text(item["query_id"], 64),
        new_count: whole(item["new_count"]),
        full_count: whole(item["full_count"]),
        owner_id: text(item["owner_id"], 64),
        is_global: typeof item["is_global"] === "boolean" ? item["is_global"] : undefined,
      },
    ]
  })
}

/** A failed answer as this source's refusal: Specter's status, its `errorCode` and the wait it named. */
export function failureOf(answer: ApiOutput): SourceError {
  const code = answer.error?.errorCode
  const said = code === undefined ? "" : ` (${code})`
  const wait = answer.credits?.resetSeconds ?? answer.rateLimit?.resetSeconds
  const retry = wait === undefined ? {} : { retryAfterSec: Math.max(1, Math.ceil(wait)) }
  if (answer.status === 401) {
    return new SourceError({ code: "NEEDS_SIGN_IN", what: `Specter refused the team API key with HTTP 401${said}`, next: "Run /connect, choose Specter and paste a current team API key from the API Console, then call events_list again." })
  }
  if (answer.status === 403) {
    return code === "NOT_PERMITTED"
      ? new SourceError({ code: "UNAVAILABLE", what: `Specter answered HTTP 403${said}: the key is valid, but the team's plan does not include saved-search results`, next: "Ask Specter's support about API access to saved searches." })
      : new SourceError({ code: "NEEDS_SIGN_IN", what: `Specter refused the team API key with HTTP 403${said}`, next: "Run /connect, choose Specter and paste a current team API key, then call events_list again." })
  }
  if (answer.status === 402) {
    return new SourceError({
      code: "BUDGET_EXCEEDED",
      what: code === "DAILY_CREDIT_CAP_REACHED" ? "Specter stopped the read: the organisation's daily credit limit is reached" : `Specter stopped the read: the team's credit budget for this period is spent${said}`,
      next: "Read the saved search again once the credits renew, or ask Specter's support for more credits.",
      ...retry,
    })
  }
  if (answer.status === 404) {
    return new SourceError({ code: "INPUT_INVALID", what: "Specter knows no saved search with the scope's id, or it is not shared with the API", next: "Pass scope.search, the id of a saved company search shared to the API; the free saved-search list shows them." })
  }
  if (answer.status === 400 || answer.status === 422) {
    return new SourceError({
      code: "INPUT_INVALID",
      what: code === "NOT_SUPPORTED_PRODUCT" ? "Specter answered HTTP 400: that saved search is not a company search" : `Specter refused the read's parameters with HTTP ${answer.status}${said}`,
      next: "Pass scope.search, the id of a saved company search, and a watermark within the last 60 days.",
    })
  }
  if (answer.status === 429) {
    return new SourceError({ code: "RATE_LIMITED", what: `Specter's rate limit stopped the read with HTTP 429${said}`, next: "Wait, then call events_list again with the same cursor: the limit is 15 requests a second per team key.", ...retry })
  }
  return new SourceError({
    code: "UNAVAILABLE",
    what: `Specter answered HTTP ${answer.status}${said}${answer.requestId === undefined ? "" : ` (request ID ${answer.requestId})`}`,
    next: "Call events_list again with the same cursor; if it keeps failing, run /specter-status.",
    ...retry,
  })
}

/** The watermark an answer names: its `Date` header (a server time), or the plugin's clock when it sent none. */
export function observation(answer: ApiOutput, now: number): string {
  const at = answer.serverTime === undefined ? Number.NaN : Date.parse(answer.serverTime)
  return new Date(Number.isFinite(at) ? at : now).toISOString()
}

/** What a cursor holds. */
interface Position {
  /** The `new_results_after` cutoff of the window. */
  readonly w: string
  /** The page within the window. */
  readonly p: number
  /** Company ids already listed, dropped if they meet the read again (`i`, because `b` is the cursor's binding). */
  readonly i: readonly string[]
  /** The lost window a gap answered, kept as a record, never recomputed. */
  readonly g?: string
}

const bindingOf = (search: string): CursorBinding => ({ plugin: "specter", source: SOURCE, account: ACCOUNT, scope: { [SCOPE_KEY]: search } })

const isoTime = (value: unknown): value is string => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))

function positionOf(cursor: string, search: string): Position {
  const decoded = decodeBoundCursor(bindingOf(search), cursor)
  if (!decoded.ok) {
    refuse("CURSOR_INVALID", "The cursor is not this source's, this account's and this saved search's", "Start the read again with since, or with the previous result's cursor.")
  }
  const { state } = decoded
  const [w, p, i, g] = [state["w"], state["p"], state["i"], state["g"]]
  if (!isoTime(w) || typeof p !== "number" || !Number.isSafeInteger(p) || p < 0 || p > 1_000_000) {
    refuse("CURSOR_INVALID", "The cursor does not hold this source's watermark and page", "Start the read again with since, or with the previous result's cursor.")
  }
  if (!Array.isArray(i) || i.length > BOUNDARY_IDS || !i.every((id): id is string => typeof id === "string" && COMPANY_ID.test(id))) {
    refuse("CURSOR_INVALID", "The cursor does not hold this source's boundary ids", "Start the read again with since, or with the previous result's cursor.")
  }
  if (g !== undefined && !isoTime(g)) {
    refuse("CURSOR_INVALID", "The cursor's gap record is not a time", "Start the read again with since, or with the previous result's cursor.")
  }
  return { w, p, i, ...(g === undefined ? {} : { g }) }
}

/** The scope's saved-search id, canonical (`scope.search` is a string or a one-item list). */
function searchOf(scope: Record<string, string | string[]> | undefined): string | undefined {
  const value = scope?.[SCOPE_KEY]
  const id = Array.isArray(value) ? (value.length === 1 ? value[0] : undefined) : value
  return id !== undefined && SEARCH_ID.test(id) ? id : undefined
}

/** One company as a contract event: metadata only (id, name), never prose, and a link only when Specter gives one. */
export function toEvent(company: CompanyRecord, observedAt: string): SourceEvent {
  return makeEvent({
    source: SOURCE,
    account: ACCOUNT,
    external_id: `${EXTERNAL_PREFIX}${company.id}`,
    kind: EVENT_KIND,
    occurred_at: observedAt,
    thread: null,
    actors: [],
    title: company.organization_name ?? company.id,
    text: "",
    // The API reference does not publish Specter's own company-page address, so an event links nowhere rather than
    // guessing one.
    url: null,
    labels: [],
  })
}

/** What one results page cost: one credit per company Specter returned, which is what its reference states. */
export const costOf = (results: number): EventsCost | undefined => (results > 0 ? { units: [{ per: "credit", count: results }] } : undefined)

/** The code, what happened and the next step of the plugin's own request failure, when `error` is one. */
export function pluginFailureOf(error: unknown): { readonly code: string; readonly what: string; readonly next: string } | undefined {
  if (!(error instanceof Error)) return undefined
  const coded = error as Error & { code?: unknown; detail?: unknown; nextStep?: unknown }
  if (typeof coded.code !== "string" || typeof coded.nextStep !== "string") return undefined
  return { code: coded.code, what: typeof coded.detail === "string" ? coded.detail : coded.message, next: coded.nextStep }
}

export interface ListingOptions {
  /** The read and the owner, from the team key; NEEDS_SIGN_IN when none is connected. */
  readonly open: () => Promise<SourceAccess | undefined>
  /** The clock, for `since` and a page's observation time; Date.now in the plugin, fixed in the tests. */
  readonly now: number
}

/**
 * One page of events for the saved search the scope names. Throws a SourceError for the caller's mistakes, Specter's
 * failures and an expired watermark; the input, the account and the cursor are checked before any read.
 */
export async function listEvents(input: unknown, options: ListingOptions): Promise<EventsListResult> {
  const parsed = parseEventsListInput(input, { scopeKeys: [SCOPE_KEY] })
  if (!parsed.ok) refuse("INPUT_INVALID", `The events_list input is invalid: ${parsed.problems.join("; ")}`, "Pass source, scope.search, and a cursor or since, as events_list's schema describes.")
  const request = parsed.value
  if (request.source !== undefined && request.source !== SOURCE) {
    refuse("SOURCE_UNKNOWN", `This plugin's saved-search source is "${SOURCE}"`, `Pass source "${SOURCE}", or leave it out.`)
  }
  if (request.account !== undefined && request.account !== ACCOUNT) {
    refuse("ACCOUNT_MISMATCH", `Specter's team key names one account, ${ACCOUNT}`, `Pass account "${ACCOUNT}", or leave it out.`)
  }
  const search = searchOf(request.scope)
  if (search === undefined) {
    refuse("INPUT_INVALID", `The read names no saved search: scope.${SCOPE_KEY} is required`, "Pass scope.search, the id of a saved company search shared to the API.")
  }
  const held = await options.open()
  if (held === undefined) refuse("NEEDS_SIGN_IN", "No Specter team API key is connected, so the saved-search source cannot read", "Run /connect, choose Specter and paste the team API key from the API Console, then call events_list again.")
  const { read, owner } = held
  const nowIso = new Date(options.now).toISOString()
  const position: Position = request.cursor === undefined
    ? { w: new Date(Math.min(startTime(request, options.now), options.now)).toISOString(), p: 0, i: [] }
    : positionOf(request.cursor, search)
  const limit = Math.min(request.limit, MAX_PAGE)

  // The 60-day window is checked before the call: a 422 would cost nothing but a round trip, and the answer must be
  // this source's own gap, never Specter's error.
  if (Date.parse(position.w) < options.now - RETENTION_MS) return gapPage(search, position, owner, options.now, nowIso)

  let answer: ApiOutput
  try {
    answer = await read({
      method: "GET",
      path: `/searches/companies/${search}/results`,
      query: { new_results_after: position.w, page: position.p, limit },
      class: "spend",
    })
  } catch (error) {
    const named = pluginFailureOf(error)
    if (named === undefined) throw error
    throw new SourceError({ code: "UNAVAILABLE", what: named.what, next: named.next })
  }
  if (!answer.ok && answer.status === 422 && answer.error?.errorCode === "NEW_RESULTS_AFTER_BEYOND_RETENTION") {
    return gapPage(search, position, owner, options.now, nowIso)
  }
  if (!answer.ok) throw failureOf(answer)

  const companies = companiesOf(answer.data)
  const observedAt = observation(answer, options.now)
  const seen = new Set(position.i)
  const fresh = companies.filter((company) => (seen.has(company.id) ? false : (seen.add(company.id), true)))
  // Everything on a page became visible in this read, so each event's occurred_at is this read's observation time.
  const screened = screenEvents(fresh.map((company) => toEvent(company, observedAt)))
  const fits = fitPage(screened.events, limit, MAX_BYTES)
  const page = screened.events.slice(0, fits)
  // The vendor page was full, or this page was cut for size: either way there is more to list, under the same
  // watermark. The ids listed are carried so the next read does not repeat them.
  const full = companies.length >= limit
  const cut = fits < screened.events.length
  const done = !full && !cut
  const cursor = encodeBoundCursor(bindingOf(search), {
    w: done ? observedAt : position.w,
    // A page cut for size is read again with the ids it listed carried, so the next read lists the rest of it; only a
    // full vendor page moves the offset.
    p: done ? 0 : cut ? position.p : position.p + 1,
    i: done ? companies.map((company) => company.id).slice(0, BOUNDARY_IDS) : page.map((event) => event.external_id.slice(EXTERNAL_PREFIX.length)),
    ...(position.g === undefined ? {} : { g: position.g }),
  })
  const cost = costOf(companies.length)
  return eventsListResult(
    { source: SOURCE, account: ACCOUNT, owner },
    page,
    cursor,
    !done,
    {
      scope: { [SCOPE_KEY]: search },
      ...(screened.refused.length > 0 ? { refused: screened.refused } : {}),
      ...(cost === undefined ? {} : { cost }),
      plugin: PACKAGE,
      asOf: observedAt,
    },
  )
}

/**
 * The page that answers a gap: no events, `gap.reason: "expired"` and the lost window's start, and a cursor whose
 * watermark is the first moment Specter can still answer for. It is answered once: the cursor it answers carries a
 * fresh watermark, so the next read starts after the hole rather than going round it again.
 *
 * The restart line is the old watermark plus Specter's 60-day window, not "now": Specter still tracks everything added
 * in the last 60 days, so restarting there recovers all of it, and a consumer that retries the same expired cursor
 * gets the same line rather than one that has slid forward. Only a cursor older than twice the window has no line but
 * the edge of the window itself, which moves with the clock because nothing earlier can be read at all.
 */
function gapPage(search: string, position: Position, owner: EventsOwner, now: number, nowIso: string): EventsListResult {
  const restartAt = Math.min(now, Math.max(Date.parse(position.w) + RETENTION_MS, now - RETENTION_MS + RESTART_GRACE_MS))
  const restart = encodeBoundCursor(bindingOf(search), { w: new Date(restartAt).toISOString(), p: 0, i: [], ...(position.g === undefined ? { g: position.w } : { g: position.g }) })
  return eventsListResult({ source: SOURCE, account: ACCOUNT, owner }, [], restart, false, {
    scope: { [SCOPE_KEY]: search },
    gap: { reason: "expired", since: position.w },
    plugin: PACKAGE,
    asOf: nowIso,
  })
}

/**
 * `probe` (the source contract's): the organisation whose team key is connected, named from the free credit balance
 * and nothing it reads. A team key names no person, and the balance answer names no organisation, so the owner is the
 * key itself, `specter:key:<fingerprint>`: a scheme-qualified id the provider does not confirm, which is why the
 * plugin holds `verified: false` back until consumers re-vendor the contract that accepts it.
 */
export async function probe(input: unknown, options: { readonly open: () => Promise<SourceAccess> }): Promise<ProbeResult> {
  const parsed = parseProbeInput(input)
  if (!parsed.ok) refuse("INPUT_INVALID", `The probe input is invalid: ${parsed.problems.join("; ")}`, "Pass only source and account, as probe's schema describes.")
  if (parsed.value.source !== undefined && parsed.value.source !== SOURCE) {
    refuse("SOURCE_UNKNOWN", `This plugin's saved-search source is "${SOURCE}"`, `Pass source "${SOURCE}", or leave it out.`)
  }
  if (parsed.value.account !== undefined && parsed.value.account !== ACCOUNT) {
    refuse("ACCOUNT_MISMATCH", `Specter's team key names one account, ${ACCOUNT}`, `Pass account "${ACCOUNT}", or leave it out.`)
  }
  const held = await options.open()
  if (held === undefined) refuse("NEEDS_SIGN_IN", "No Specter team API key is connected, so the saved-search source cannot read", "Run /connect, choose Specter and paste the team API key from the API Console, then call events_list again.")
  const { read, owner } = held
  let answer: ApiOutput
  try {
    answer = await read({ method: "GET", path: "/organization/credits", class: "read" })
  } catch (error) {
    const named = pluginFailureOf(error)
    if (named === undefined) throw error
    throw new SourceError({ code: "UNAVAILABLE", what: named.what, next: named.next })
  }
  // 402 is a valid key whose credits are spent, so it names the organisation too; 401 and a key refusal do not.
  if (!answer.ok && answer.status !== 402) throw failureOf(answer)
  return probeResult({ source: SOURCE, account: ACCOUNT, owner })
}

/** The owner a key names: `specter:key:<fingerprint>`, the key's SHA-256 prefix, never the key. */
export function ownerOf(fingerprint: string): EventsOwner {
  const short = fingerprint.slice(0, 16)
  return { id: `specter:key:${short}`, label: `Specter team key ${short.slice(0, 8)}` }
}
