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
 * - Paging is `page`/`limit`, so a position is `offset = page × limit`: any offset is reachable by choosing both.
 * - The call costs **1 credit per result returned**; a 4xx or 5xx is not charged
 *   (https://api.tryspecter.com/api-ref/rate_limits.md, https://api.tryspecter.com/api-ref/errors.md).
 * - A `searchId` that is not a number answers 422; an unknown or unshared search answers 404; a search of another
 *   product answers 400 `NOT_SUPPORTED_PRODUCT`.
 * - Result records carry **no "added to the search at" time** (the `CompanyV1Response` schema lists `last_updated` and
 *   no addition field), and the order of results under `new_results_after` is undocumented. So an event's
 *   `occurred_at` is the **read's observation time** — the moment the page that listed the company was answered —
 *   never the company's own `last_updated`, which is not when it became visible. `docs/costs.md` and the skill say so.
 * - `GET /searches` lists every saved search shared with the API (id, name, product_type, query_id, new_count,
 *   full_count, owner_id, is_global) and is free; it is this source's `scope.suggest` and the plugin's own
 *   `list_saved_searches` tool.
 *
 * **The cursor** is this source's own, bound to the plugin, the source, the account and the search (`cursor`). Its
 * state is four small fields, and its worst case (a full page, six-figure page number, 20-digit search id) is 922
 * characters, inside source-contract's 1,024 (a test pins both numbers):
 *
 * - `w` is the **watermark**: the `new_results_after` cutoff of the window being read. It is a *server* time when the
 *   answer carries a `Date` header (HTTP requires one, and Specter's server clock is the one that stamps additions),
 *   else the plugin's clock **minus a margin**, so a local clock ahead of Specter's cannot skip anything.
 * - `f` is the window's **first observation**, the `Date` of its first page, kept until the window ends.
 * - `p` is the **page** within the window. The watermark is fixed for the whole window and only the page advances, so
 *   a burst of companies added at one instant drains page by page and never jams.
 * - `k` holds a **40-bit hash of each company id** the window has seen (never the ids themselves, so the cursor stays
 *   small whatever their length), and a company whose hash is already there is dropped instead of repeated: the first
 *   `q` entries are the previous window's, pinned until the lookback has passed them, and the rest are this window's.
 *   Forty bits rather than the thirty-two an eight-character prefix would give: about fifty ids over 32 bits collide
 *   once in 30 million windows, some thirty times a year at 5-minute polls, and a collision drops a company; forty bits
 *   make it about once in 13,000 years.
 *
 * **The window's next watermark is `f − LOOKBACK`**, not the last page's time. Offset paging over a set that can
 * change has no stable order: a company added while the reader pages can land at an offset already read, a company
 * that stops matching shifts the rest back one, and an addition can become visible after an answer that already
 * carried a later `Date`. The lookback re-reads the last couple of minutes of additions, so those arrive in the next
 * window; what it cannot catch within one window is caught by the **page overlap**: after the first page, the previous
 * page's tail is read again (its last `OVERLAP` companies, or the whole page when the caller's limit is smaller) and
 * dropped by hash. The overlap is read *first*, so a failure there risks its few credits rather than the page's. Both
 * cost credits — re-reads are charged like any other result — and `docs/costs.md` says so. `LOOKBACK` is an assumption
 * (two minutes) until live check 2 measures the lag between an addition and its visibility.
 *
 * **A window bigger than the carry skips its lookback rather than repeating it.** The cursor can pin 20 companies
 * (`CARRY_PINNED`). When a window listed more, the lookback could not de-duplicate them, so the plugin starts the next
 * window at that window's first answer instead — never re-listing and re-charging the burst — records the line it did
 * not read (`u`) so no later window reads back into it until the lookback line has passed, and answers one
 * `gap { reason: "window-truncated" }` for the skipped stretch, once.
 *
 * A company the plugin does not recognise, and a body cut at the inline cap, **fail the whole page** (`UNAVAILABLE`,
 * the cursor held): a page that silently dropped an item or ended early would lose history and under-report credits.
 *
 * **A gap** (a watermark older than Specter's 60 days) is answered once, with `more: true`: the cursor's watermark is
 * the earliest line still readable, `max(w, now − 60d + grace)`, so everything Specter still holds is listed rather
 * than skipped; on Specter's own 422 the line is `now`, because nothing earlier is known to be readable. The lost
 * window's start is reported once, in `gap.since`, and never repeated.
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
import { createHash } from "node:crypto"
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
/** The most companies one page lists, and the vendor limit of the page it reads. */
export const MAX_PAGE = 25
/** The companies of the previous page read again to absorb a shift mid-window, and dropped by hash. */
export const OVERLAP = 5
/** The lookback the next window starts before this window's first observation: an assumption until live check 2. */
export const LOOKBACK_MS = 2 * 60_000
/**
 * How many hex characters of a company id's SHA-256 the cursor carries: 40 bits. Eight would carry more ids in the same
 * space, but fifty ids over 32 bits collide about once in 30 million windows — some thirty times a year at 5-minute
 * polls — and a collision drops a company; forty bits make it about once in 13,000 years. A test pins the length.
 */
export const HASH_CHARS = 10
/**
 * A window that lists this many companies or fewer keeps the lookback: its ids fit the cursor, so the re-read lists
 * nothing twice. A window that lists more cannot be carried, so the lookback is skipped and one `window-truncated` gap
 * says so, rather than re-listing and re-charging the whole burst.
 */
export const CARRY_PINNED = 20
/** The hashes a window carries of its own listings while it pages, so the overlap and a repeat are dropped. */
export const CARRY_RECENT = 20
export const MAX_CARRIED = CARRY_PINNED + CARRY_RECENT
/** Specter tracks additions to a saved search for 60 days; an older cutoff answers 422 rather than a partial answer. */
export const RETENTION_DAYS = 60
const RETENTION_MS = RETENTION_DAYS * 86_400_000
/** How far inside Specter's window a restart line sits, so clock skew between the two never asks for the very edge. */
const RESTART_GRACE_MS = 3_600_000
/** The local clock is pulled back this far when an answer carries no `Date`, so it can only be behind Specter's. */
export const CLOCK_MARGIN_MS = 5_000
/** The most bytes this source reads into memory: a page of records, which it keeps only ids and names from. */
export const SOURCE_INLINE_BYTES = 8 * 1024 * 1024
/** What one record is budgeted to cost, so `MAX_PAGE` records stay inside SOURCE_INLINE_BYTES with room to spare. */
export const RECORD_BUDGET_BYTES = 256 * 1024
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

/** A company's id, as Specter writes it (24 hex in its reference): letters, digits, `_` and `-`. */
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
    founded_year: year(value["founded_year"]),
    ...(industries(value["industry"]) === undefined ? {} : { industry: industries(value["industry"]) }),
    growth_stage: text(value["growth_stage"], 80),
    description: text(value["description"], 1000),
    ...(funding ? { funding } : {}),
    last_updated: text(value["last_updated"], 40),
  }
}

/**
 * The companies in one results answer. A body that is not an array, or an item the plugin does not recognise, fails
 * the whole page as `UNAVAILABLE`: a page that dropped an item would lose history and still be charged for it.
 */
export function companiesOf(data: unknown): CompanyRecord[] {
  if (!Array.isArray(data)) {
    refuse("UNAVAILABLE", "Specter's saved-search results answer is not the array of companies its reference documents", "Try again with the same cursor; if it keeps happening, Specter's API has changed and the plugin needs an update.")
  }
  return data.map((item) => {
    const company = companyOf(item)
    if (company === undefined) {
      refuse("UNAVAILABLE", "Specter's saved-search results held a company record this plugin does not recognise, so the page cannot be listed without losing it", "Try again with the same cursor; if it keeps happening, Specter's API has changed and the plugin needs an update.")
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
export function failureOf(answer: ApiOutput, watermark?: string): SourceError {
  const code = answer.error?.errorCode
  const said = code === undefined ? "" : ` (${code})`
  const wait = answer.credits?.resetSeconds ?? answer.rateLimit?.resetSeconds
  const retry = wait === undefined ? {} : { retryAfterSec: Math.max(1, Math.ceil(wait)) }
  if (answer.status === 401) {
    return new SourceError({ code: "NEEDS_SIGN_IN", what: `Specter refused the team API key with HTTP 401${said}`, next: "Run /connect, choose Specter and paste a current team API key from the API Console, then call events_list again." })
  }
  if (answer.status === 403) {
    return code === "NOT_PERMITTED"
      ? new SourceError({ code: "UNAVAILABLE", what: `Specter answered HTTP 403${said}: the key is valid, but the team's plan does not include this endpoint`, next: "Ask Specter's support about API access to it." })
      : new SourceError({ code: "NEEDS_SIGN_IN", what: `Specter refused the team API key with HTTP 403${said}`, next: "Run /connect, choose Specter and paste a current team API key, then call events_list again." })
  }
  if (answer.status === 402) {
    // The contract's BUDGET_EXCEEDED is a person's own budget, not the provider's: Specter's credit pool is the
    // provider's limit, so it is RATE_LIMITED, with the wait Specter named.
    return new SourceError({
      code: "RATE_LIMITED",
      what: code === "DAILY_CREDIT_CAP_REACHED" ? "Specter stopped the read: the organisation's daily credit limit is reached" : `Specter stopped the read: the team's credit budget for this period is spent${said}`,
      next: "Wait for the credits to renew, then call events_list again with the same cursor; an admin can ask Specter's support for more.",
      ...retry,
    })
  }
  if (answer.status === 404) {
    return new SourceError({ code: "INPUT_INVALID", what: "Specter knows no saved search with the scope's id, or it is not shared with the API", next: "Pass scope.search, the id of a saved company search shared to the API; the free saved-search list shows them." })
  }
  if (answer.status === 422 && code === "NEW_RESULTS_AFTER_BEYOND_RETENTION") {
    // Specter itself says the cutoff is older than its 60-day window: history is lost, so this is the contract's
    // CURSOR_EXPIRED, with the window that aged out.
    return new SourceError({
      code: "CURSOR_EXPIRED",
      what: `Specter answered HTTP 422${said}: it tracks additions to a saved search for ${RETENTION_DAYS} days, and the cursor's watermark is older`,
      next: "The source answers a gap and restarts from the earliest line Specter can still serve; call events_list again with the cursor it answered.",
      ...(watermark === undefined ? {} : { gap: { reason: "expired" as const, since: watermark } }),
    })
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

/**
 * The watermark an answer names: its `Date` header (a server time), or the plugin's clock pulled back by
 * `CLOCK_MARGIN_MS`, so a local clock ahead of Specter's can only make the next read ask for more, never less.
 */
export function observation(answer: ApiOutput, now: number): string {
  const at = answer.serverTime === undefined ? Number.NaN : Date.parse(answer.serverTime)
  return new Date(Number.isFinite(at) ? at : now - CLOCK_MARGIN_MS).toISOString()
}

/** What a cursor holds. */
interface Position {
  /** The window's `new_results_after` cutoff. */
  readonly w: string
  /** The window's first observation, until the window ends. */
  readonly f?: string
  /** The page within the window. */
  readonly p: number
  /** A 10-hex hash per company id already listed, so none is repeated. */
  readonly k: readonly string[]
  /** How many of `k` are the previous window's, pinned until the lookback has passed them; the rest are this window's. */
  readonly q: number
  /** How many companies this window has listed, capped at CARRY_PINNED + 1. */
  readonly n: number
  /** No lookback may read before this line: a window whose burst the cursor could not carry was skipped. */
  readonly u?: string
  /** The skipped lookback's start, answered once as a `window-truncated` gap. */
  readonly t?: string
}

const bindingOf = (search: string): CursorBinding => ({ plugin: "specter", source: SOURCE, account: ACCOUNT, scope: { [SCOPE_KEY]: search } })

const isoTime = (value: unknown): value is string => typeof value === "string" && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value))
const HASH = new RegExp(`^[0-9a-f]{${HASH_CHARS}}$`)

/** A company id's hash, as the cursor carries it: 16 hex characters of its SHA-256, never the id. */
export function hashOf(id: string): string {
  return createHash("sha256").update(id).digest("hex").slice(0, HASH_CHARS)
}

/**
 * The longest this source's cursor can be: every hash the carry holds, a six-figure page, both window lines and the
 * longest search id. The state fields are fixed-width, so this is the true worst case; `encodeBoundCursor` refuses
 * anything over 1,024, and a test pins it.
 */
export function maxCursorLength(search: string): number {
  const at = "2026-11-30T23:59:59.999Z"
  const state = {
    w: at,
    f: at,
    p: 999_999,
    q: CARRY_PINNED,
    n: CARRY_PINNED + 1,
    k: Array.from({ length: MAX_CARRIED }, () => "0123456789abcdef".slice(0, HASH_CHARS)),
    u: at,
    t: at,
  }
  return encodeBoundCursor(bindingOf(search), state).length
}

/** The cursor budget, checked before any read: a page must never be fetched if its cursor could not be issued. */
function assertCursorFits(search: string): void {
  if (maxCursorLength(search) <= 1024) return
  refuse("UNAVAILABLE", "This source's cursor would be longer than the source contract allows, so the read was not made", "Report this: the plugin sizes its page against the cursor's limit, and this is a bug.")
}

function positionOf(cursor: string, search: string): Position {
  const decoded = decodeBoundCursor(bindingOf(search), cursor)
  if (!decoded.ok) {
    refuse("CURSOR_INVALID", "The cursor is not this source's, this account's and this saved search's", "Start the read again with since, or with the previous result's cursor.")
  }
  const { state } = decoded
  const [w, p, k] = [state["w"], state["p"], state["k"]]
  // A cursor from before the carry was split says neither: it is read as an empty previous window.
  const [q, n] = [state["q"] ?? 0, state["n"] ?? 0]
  const [f, u, t] = [state["f"], state["u"], state["t"]]
  if (!isoTime(w) || typeof p !== "number" || !Number.isSafeInteger(p) || p < 0 || p > 1_000_000) {
    refuse("CURSOR_INVALID", "The cursor does not hold this source's watermark and page", "Start the read again with since, or with the previous result's cursor.")
  }
  for (const [value, what] of [
    [f, "window start"],
    [u, "lookback floor"],
    [t, "skipped lookback"],
  ] as const) {
    if (value !== undefined && !isoTime(value)) {
      refuse("CURSOR_INVALID", `The cursor's ${what} is not a time`, "Start the read again with since, or with the previous result's cursor.")
    }
  }
  if (!Array.isArray(k) || k.length > MAX_CARRIED || !k.every((hash): hash is string => typeof hash === "string" && HASH.test(hash))) {
    refuse("CURSOR_INVALID", "The cursor does not hold this source's listed-company hashes", "Start the read again with since, or with the previous result's cursor.")
  }
  if (typeof q !== "number" || !Number.isSafeInteger(q) || q < 0 || q > k.length || typeof n !== "number" || !Number.isSafeInteger(n) || n < 0 || n > CARRY_PINNED + 1) {
    refuse("CURSOR_INVALID", "The cursor does not say how much of its carry is the previous window's", "Start the read again with since, or with the previous result's cursor.")
  }
  return { w, p, k, q, n, ...(isoTime(f) ? { f } : {}), ...(isoTime(u) ? { u } : {}), ...(isoTime(t) ? { t } : {}) }
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

/**
 * What one results page cost: one credit per company Specter returned, which is what its reference states. `per` names
 * the descriptor's one price unit, `company`, whose dollar figure is the plugin's estimate (see `src/costs.ts`).
 */
export const costOf = (results: number): EventsCost | undefined => (results > 0 ? { units: [{ per: "company", count: results }] } : undefined)

/**
 * The vendor page size for a caller's `limit`: never more than the caller asked for and never more than MAX_PAGE, so a
 * page read is never cut by the caller's limit, and costs only what it returns.
 */
export function pageSizeFor(limit: number): number {
  return Math.max(1, Math.min(limit, MAX_PAGE))
}

/**
 * The overlap read for page `p`: the previous page's tail, so a company that shifted back is still listed. A page size
 * that is a multiple of OVERLAP reads just that tail; any other (a caller's limit below 5) re-reads the previous small
 * page whole, which costs what it returns and is still cheaper than losing a company to a shift.
 */
export function overlapReadFor(page: number, pageSize: number): { readonly page: number; readonly limit: number } {
  if (pageSize % OVERLAP === 0) return { page: (page * pageSize - OVERLAP) / OVERLAP, limit: OVERLAP }
  return { page: page - 1, limit: pageSize }
}

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

/** One vendor page: the companies it returned and how many it returned before the inline cap. */
interface VendorPage {
  readonly companies: CompanyRecord[]
  readonly returned: number
  readonly observedAt: string
}

/** One page of the results endpoint, read with this source's inline budget, failing closed on a cut or bad body. */
async function vendorPage(read: Read, search: string, watermark: string, page: number, limit: number, now: number): Promise<VendorPage> {
  let answer: ApiOutput
  try {
    answer = await read({
      method: "GET",
      path: `/searches/companies/${search}/results`,
      query: { new_results_after: watermark, page, limit },
      class: "spend",
      maxInlineBytes: SOURCE_INLINE_BYTES,
    })
  } catch (error) {
    const named = pluginFailureOf(error)
    if (named === undefined) throw error
    throw new SourceError({ code: "UNAVAILABLE", what: named.what, next: named.next })
  }
  if (!answer.ok) throw failureOf(answer, watermark)
  // A body cut at the inline cap is not a short page: the rest of it was never read, so nothing here may be listed.
  if (answer.truncated) {
    refuse("UNAVAILABLE", `Specter's answer was cut at ${SOURCE_INLINE_BYTES} bytes, so this page is incomplete`, "Call events_list again with the same cursor; if it keeps happening, the plugin's page size needs lowering.")
  }
  return { companies: companiesOf(answer.data), returned: answer.itemsReturned ?? (Array.isArray(answer.data) ? answer.data.length : 0), observedAt: observation(answer, now) }
}

/**
 * One page of events for the saved search the scope names. Throws a SourceError for the caller's mistakes, Specter's
 * failures and an expired watermark; the input, the account, the cursor and the cursor's own budget are checked before
 * any read.
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
  // The cursor's own budget, before any read: a page must never be fetched if its cursor could not be issued.
  assertCursorFits(search)
  const held = await options.open()
  if (held === undefined) refuse("NEEDS_SIGN_IN", "No Specter team API key is connected, so the saved-search source cannot read", "Run /connect, choose Specter and paste the team API key from the API Console, then call events_list again.")
  const { read, owner } = held
  const nowIso = new Date(options.now).toISOString()
  const position: Position = request.cursor === undefined
    ? { w: new Date(Math.min(startTime(request, options.now), options.now)).toISOString(), p: 0, k: [], q: 0, n: 0 }
    : positionOf(request.cursor, search)

  // The 60-day window is checked before the call: a 422 would cost nothing but a round trip, and the answer must be
  // this source's own gap, never Specter's error. The restart is the earliest line Specter can still serve.
  const edge = options.now - RETENTION_MS + RESTART_GRACE_MS
  if (Date.parse(position.w) < options.now - RETENTION_MS) {
    return gapPage(search, position, owner, Math.max(Date.parse(position.w), edge, position.u === undefined ? 0 : Date.parse(position.u)), nowIso)
  }

  // The page: the previous page's tail first (so a failed read risks its few credits, not the page's), then the page
  // itself. Both either succeed whole or fail the page, and nothing is listed from a page that was not read whole.
  const pageSize = pageSizeFor(request.limit)
  let main: VendorPage
  let overlap: VendorPage | undefined
  try {
    if (position.p > 0) {
      const where = overlapReadFor(position.p, pageSize)
      overlap = await vendorPage(read, search, position.w, where.page, where.limit, options.now)
    }
    main = await vendorPage(read, search, position.w, position.p, pageSize, options.now)
  } catch (error) {
    // Specter's own retention 422 is the one gap it decides. Its clock, not the plugin's, said the watermark was too
    // old, so restart at the window's edge; only when the cursor is already at or past that edge (a clock more than
    // the grace behind Specter's) is nothing earlier known to be readable, and the restart is now.
    if (error instanceof SourceError && error.code === "CURSOR_EXPIRED") {
      return gapPage(search, position, owner, Date.parse(position.w) < edge ? edge : options.now, nowIso)
    }
    throw error
  }
  const observedAt = main.observedAt
  const seen = new Set(position.k)
  const listed: CompanyRecord[] = []
  for (const company of [...(overlap?.companies ?? []), ...main.companies]) {
    const hash = hashOf(company.id)
    if (seen.has(hash)) continue
    seen.add(hash)
    listed.push(company)
  }
  // Everything on a page became visible in this read, so each event's occurred_at is this read's observation time.
  const screened = screenEvents(listed.map((company) => toEvent(company, observedAt)))
  const fits = fitPage(screened.events, request.limit, MAX_BYTES)
  const page = screened.events.slice(0, fits)
  const full = main.returned >= pageSize
  const cut = fits < screened.events.length
  const done = !full && !cut
  const first = position.f ?? observedAt
  const count = Math.min(CARRY_PINNED + 1, position.n + (cut ? page.length : listed.length))
  const pinned = position.k.slice(0, position.q)
  const recent = position.k.slice(position.q)
  const cost = costOf(main.returned + (overlap?.returned ?? 0))
  // The skipped lookback is answered on the first page of its window, once: the page's cursor no longer carries it.
  const skipped = position.t !== undefined && position.p === 0 ? position.t : undefined
  let state: Record<string, unknown>
  if (done) {
    // The lookback is kept only when this window's ids fit the carry: then the next window may re-read the last two
    // minutes and list nothing twice. A bigger window cannot be carried, so the lookback is skipped — never re-listing
    // and re-charging the burst — and the skipped stretch is named once as `window-truncated`. The floor `u` keeps a
    // later window from reading back into it until the lookback line has passed it.
    const lookback = count <= CARRY_PINNED
    const floor = position.u === undefined ? 0 : Date.parse(position.u)
    const next = new Date(Math.max(Date.parse(first) - (lookback ? LOOKBACK_MS : 0), Date.parse(position.w) + 1, floor)).toISOString()
    // The pinned set carries every hash this window knows — the ones it listed and the ones the lookback re-read and
    // dropped — so a company still inside the lookback is not listed on the window after it either.
    const windowHashes = lookback ? [...seen].slice(-CARRY_PINNED) : []
    const skippedFrom = !lookback && Date.parse(first) - LOOKBACK_MS > Date.parse(position.w) ? new Date(Date.parse(first) - LOOKBACK_MS).toISOString() : undefined
    state = {
      w: next,
      p: 0,
      q: windowHashes.length,
      n: 0,
      k: windowHashes,
      // The floor stays while it can still bind: a later window's lookback must not read back into a skipped stretch.
      ...(floor === 0 && lookback ? {} : { u: new Date(Math.max(floor, lookback ? 0 : Date.parse(first))).toISOString() }),
      ...(skippedFrom === undefined ? {} : { t: skippedFrom }),
    }
  } else {
    // Mid-window: the previous window's hashes stay pinned, so the lookback's repeats are dropped for the whole window,
    // and this window's own hashes grow up to CARRY_RECENT. A page cut for size is read again at the same offset and
    // carries only what it has listed, so the rest is still there next time.
    const fresh = cut ? page.map((event) => hashOf(event.external_id.slice(EXTERNAL_PREFIX.length))) : listed.map((company) => hashOf(company.id))
    const grown = [...new Set([...recent, ...fresh])].slice(-CARRY_RECENT)
    state = {
      w: position.w,
      f: first,
      p: cut ? position.p : position.p + 1,
      q: pinned.length,
      n: count,
      k: [...pinned, ...grown],
      ...(position.u === undefined ? {} : { u: position.u }),
      ...(position.t === undefined || skipped !== undefined ? {} : { t: position.t }),
    }
  }
  let cursor: string
  try {
    cursor = encodeBoundCursor(bindingOf(search), state)
  } catch (error) {
    // The budget was checked before the read, so this is a bug, not a full page: refuse rather than throw a plain Error
    // whose page the consumer could not resume from.
    refuse("UNAVAILABLE", `This source's cursor could not be issued (${error instanceof Error ? error.message : "an unknown error"})`, "Report this: the plugin sizes its page against the cursor's limit, and this is a bug.")
  }
  return eventsListResult(
    { source: SOURCE, account: ACCOUNT, owner },
    page,
    cursor,
    !done,
    {
      scope: { [SCOPE_KEY]: search },
      ...(skipped === undefined ? {} : { gap: { reason: "window-truncated" as const, since: skipped } }),
      ...(screened.refused.length > 0 ? { refused: screened.refused } : {}),
      ...(cost === undefined ? {} : { cost }),
      plugin: PACKAGE,
      asOf: observedAt,
    },
  )
}

/**
 * The page that answers a gap: no events, `gap.reason: "expired"` and the lost window's start, and `more: true` so the
 * consumer reads on at once from a line Specter can still serve — the earliest readable one, carried in the cursor.
 * It is answered once: the cursor it answers carries a fresh watermark, and no later page repeats the gap.
 */
function gapPage(search: string, position: Position, owner: EventsOwner, restartAt: number, nowIso: string): EventsListResult {
  const restart = encodeBoundCursor(bindingOf(search), { w: new Date(restartAt).toISOString(), p: 0, k: [], q: 0, n: 0 })
  return eventsListResult({ source: SOURCE, account: ACCOUNT, owner }, [], restart, true, {
    scope: { [SCOPE_KEY]: search },
    gap: { reason: "expired", since: position.w },
    plugin: PACKAGE,
    asOf: nowIso,
  })
}

/**
 * `probe` (the source contract's): the organisation whose team key is connected, named from the free credit balance
 * and nothing it reads. A team key names no person, and the balance answer names no organisation, so the owner is the
 * key itself, `specter:key:<fingerprint>`: a scheme-qualified id the provider does not confirm.
 */
export async function probe(input: unknown, options: { readonly open: () => Promise<SourceAccess | undefined> }): Promise<ProbeResult> {
  const parsed = parseProbeInput(input)
  if (!parsed.ok) refuse("INPUT_INVALID", `The probe input is invalid: ${parsed.problems.join("; ")}`, "Pass only source and account, as probe's schema describes.")
  if (parsed.value.source !== undefined && parsed.value.source !== SOURCE) {
    refuse("SOURCE_UNKNOWN", `This plugin's saved-search source is "${SOURCE}"`, `Pass source "${SOURCE}", or leave it out.`)
  }
  if (parsed.value.account !== undefined && parsed.value.account !== ACCOUNT) {
    refuse("ACCOUNT_MISMATCH", `Specter's team key names one account, ${ACCOUNT}`, `Pass account "${ACCOUNT}", or leave it out.`)
  }
  const held = await options.open()
  if (held === undefined) refuse("NEEDS_SIGN_IN", "No Specter team API key is connected, so the saved-search source cannot read", "Run /connect, choose Specter and paste the team API key from the API Console, then call probe again.")
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
