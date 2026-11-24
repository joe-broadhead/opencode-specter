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
 *   get-company-saved-search-results.md). `new_results_after` returns "only records added to the search on or after
 *   this moment" (inclusive); it "must be within the last 60 days", and an older one answers 422
 *   `NEW_RESULTS_AFTER_BEYOND_RETENTION`. Specter keeps additions for 60 days
 *   (https://api.tryspecter.com/api-ref/saved-searches.md).
 * - Paging is `page` (base 0) and `limit`, so a position is `offset = page × limit`: an offset is reachable with any
 *   `limit` that divides it.
 * - The call costs **1 credit per result returned**; a 4xx or 5xx is not charged
 *   (https://api.tryspecter.com/api-ref/rate_limits.md, https://api.tryspecter.com/api-ref/errors.md).
 * - A `searchId` that is not a number answers 422; an unknown or unshared search answers 404; a search of another
 *   product answers 400 `NOT_SUPPORTED_PRODUCT`.
 * - Result records carry **no "added to the search at" time** (the `CompanyV1Response` schema has `last_updated`, a
 *   date, and no addition field), and the **order of results is undocumented**. So an event's `occurred_at` is the
 *   **read's observation time**, and nothing below depends on the order but one stated property (A1).
 * - The free "details" call (`GET /searches/companies/{searchId}`) counts the **whole** search and "takes no query
 *   parameters" (`full_count`, and `new_count` for "the most recent month"), so it can neither count a window nor prove
 *   one unchanged (an addition and a removal cancel); the source does not call it.
 * - `GET /searches` lists every saved search shared with the API and is free; it is this source's `scope.suggest` and
 *   the plugin's own `list_saved_searches` tool.
 *
 * **The cursor.** A *window* reads `new_results_after = w` page by page at offsets `f`; `w` never moves inside a window,
 * so a burst at one instant drains by offset and never jams. Its state (the worst case is pinned by a test, under the
 * contract's 1,024):
 *
 * - `w`, the cutoff, and `f`, the offset reached (epoch seconds and a count);
 * - `n`, the next window's cutoff, `max(w, first answer's Date − LOOKBACK)`, fixed by the window's first read;
 * - `e`, an upper bound on when anything this window saw was added: its latest read's `Date` + 1 s;
 * - `a`, the **tail**: the TAIL companies just before `f`, by position, which anchor the next read;
 * - `k`, the window's new companies; `d`, companies of earlier windows re-seen here that no later window can see again;
 * - `P`, up to MAX_GROUPS **groups** of earlier windows' companies, each with its `e`; and `g`, a gap already answered.
 *
 * Companies are carried as 40-bit hashes of their ids, packed as bytes (never the ids): at most CARRY, plus the tail.
 *
 * **One call** reads the page at `f` (`limit` = the largest divisor of `f` up to the caller's page size) and, after the
 * first page, the OVERLAP companies before `f` first (so a failure there risks its few credits, not the page's). A
 * company whose hash is carried is consumed silently; a new one is listed, up to the caller's `limit`; the page stops
 * before the first event that does not fit and holds `f`, so the next call reads the same place and lists the rest.
 * At most MAX_CALL_CREDITS credits a call.
 *
 * **Why nothing is lost silently**, under two stated assumptions: (A1) results that stay in the set keep their order
 * relative to each other between two calls (additions and removals may land anywhere); (A2) a company becomes visible
 * within LOOKBACK of the moment Specter stamps its addition.
 * - A window consumes its set as a prefix. If a read after the first holds an anchor (any company this window already
 *   consumed), every company the window has not reached sorts after it (A1), so inside or beyond this read: nothing was
 *   skipped. If it holds none, more companies left before `f` than the overlap covers, so one may have been skipped:
 *   the page answers `gap { reason: "window-truncated", since: w }`, once per read, and reads on.
 * - A company added where the window has already passed became visible after the window's first read, so it was added
 *   at or after `n` (A2) and the next window lists it.
 * - The lookback is **never shortened**: losing a late arrival would need a gap, and a busy search would gap on every
 *   poll. What it costs instead is bounded repeats: see below.
 *
 * **Why nothing is listed twice**: a window lists a company only when its hash is not carried. A company listed by an
 * earlier window can come back only through the lookback, so only while its window's `e` is at or after the cutoff;
 * each group is kept exactly that long. When more than CARRY companies are in play at once (more than 64 added within
 * one lookback and one poll), the window's own are dropped first, from the middle (its first and last consumed stay:
 * the youngest sit at one end whatever the order), then the earliest groups': at most that excess is listed again, by
 * a later read. Inside one read a company comes back only if more companies are added ahead of the read, while it
 * pages, than its tail and carry hold. A 40-bit collision would drop a new company: see HASH_BYTES.
 *
 * A company the plugin does not recognise, and a body cut at the inline cap, **fail the whole page** (`UNAVAILABLE`,
 * the cursor held): a page that silently dropped an item or ended early would lose history and under-report credits.
 *
 * **A gap** (a watermark older than Specter's 60 days) is answered once, with `more: true`: the cursor's watermark is
 * the earliest line still readable, `max(w, now − 60d + grace)`, so everything Specter still holds is listed rather
 * than skipped; on Specter's own 422 the line is `now`, because nothing earlier is known to be readable. The lost
 * window's start is reported once, in `gap.since`, and never repeated.
 *
 * The live checks this design waits on are listed in `docs/costs.md`: A1 (the order between two calls), A2 (the lag
 * LOOKBACK assumes), the `Date` header, and the record size MAX_PAGE is budgeted for.
 */
import { type CursorBinding, MAX_CURSOR_LENGTH, decodeBoundCursor, encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
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
export const PACKAGE = "@we-the-rebel-alliance/specter-plugin"
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
/**
 * The most companies one vendor read returns, and so the most one page lists: the largest page the byte budget allows
 * (25 × RECORD_BUDGET_BYTES = 6.4 MB, inside SOURCE_INLINE_BYTES). A larger page would cross fewer offsets, so fewer
 * shifts; it waits for live check 1 to measure a record.
 */
export const MAX_PAGE = 25
/** The companies before a page's offset read again with it: a back-shift of fewer than this is recovered. */
export const OVERLAP = 5
/**
 * The companies just before a window's offset, by position, that the cursor always keeps: the overlap's, and ten
 * more, so companies added ahead of the read between two calls (a forward shift) are found again rather than listed
 * twice, however full the rest of the carry is.
 */
export const TAIL = OVERLAP + 10
/** The most companies, so credits, one call asks Specter for: a page and its overlap. */
export const MAX_CALL_CREDITS = MAX_PAGE + OVERLAP
/** How far before a window's first answer the next window starts: an assumption (A2) until live check 2. */
export const LOOKBACK_MS = 2 * 60_000
const LOOKBACK_S = LOOKBACK_MS / 1000
/**
 * The bytes of a company id's SHA-256 the cursor carries, never the id: 40 bits, packed as bytes (6⅔ base64url
 * characters each). A collision makes a new company look carried and drops it: with at most CARRY + TAIL carried, about
 * 7 × 10⁻¹¹ per new company, once in some 140,000 years at a hundred thousand companies a year.
 */
export const HASH_BYTES = 5
/**
 * The most company hashes the cursor carries, the tail aside: as many as fit the contract's 1,024 characters with
 * every other field at its widest (a test pins the worst case).
 */
export const CARRY = 64
/**
 * The first and last companies of each carried list kept longest: the youngest of a window sit at one end whatever the
 * order, and a forward shift brings the last-consumed back first.
 */
export const HEAD = 8
export const RECENT = 10
/** The most earlier windows whose companies the cursor keeps apart, each until its own line passes. */
export const MAX_GROUPS = 4
/** The furthest offset one window pages to: ten million companies, past anything 60 days of a search can hold. */
export const MAX_OFFSET = 9_999_999
/** Specter tracks additions to a saved search for 60 days; an older cutoff answers 422 rather than a partial answer. */
export const RETENTION_DAYS = 60
const RETENTION_MS = RETENTION_DAYS * 86_400_000
/** How far inside Specter's window a restart line sits, so clock skew between the two never asks for the very edge. */
const RESTART_GRACE_MS = 3_600_000
/** The local clock is pulled back (or forward, for an upper bound) this far when an answer carries no `Date`. */
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

/** Earlier windows' companies, kept until no later window can read them again. */
interface Group {
  /** Epoch seconds: no company in the group was added after this (its window's latest read, + 1 s). */
  readonly e: number
  readonly h: readonly string[]
}

/** What a cursor holds: the header of this file says what each field is for. */
interface Position {
  /** The window's `new_results_after`, epoch seconds. */
  readonly w: number
  /** The offset the window has consumed to. */
  readonly f: number
  /** The next window's cutoff, fixed by this window's first read. */
  readonly n?: number
  /** Epoch seconds: nothing this window saw was added after this. */
  readonly e?: number
  /** The TAIL companies just before the offset, by position, oldest first: the anchors. */
  readonly a: readonly string[]
  /** This window's new companies, in the order consumed. */
  readonly k: readonly string[]
  /** Earlier windows' companies re-seen in this window that no later window can read: kept only for this window. */
  readonly d: readonly string[]
  /** Earlier windows' companies, by group, oldest first. */
  readonly P: readonly Group[]
  /** A gap was answered in this read. */
  readonly g: boolean
}

const bindingOf = (search: string): CursorBinding => ({ plugin: "specter", source: SOURCE, account: ACCOUNT, scope: { [SCOPE_KEY]: search } })

/** The widest epoch-seconds value the cursor holds: ten digits, until the year 2286. */
const MAX_SECONDS = 9_999_999_999
const BASE64URL = /^[A-Za-z0-9_-]*$/

/** A company id's hash, as the cursor carries it: the first 40 bits of its SHA-256, in hex, never the id. */
export function hashOf(id: string): string {
  return createHash("sha256").update(id).digest().subarray(0, HASH_BYTES).toString("hex")
}

/** A list of hashes as the cursor stores it: their bytes, end to end, in base64url. */
const pack = (hashes: readonly string[]): string => Buffer.from(hashes.join(""), "hex").toString("base64url")

/** Epoch seconds, rounded down: a cutoff rounded down asks for more, never less. */
const secondsOf = (ms: number): number => Math.floor(ms / 1000)
/** A cutoff as Specter's `new_results_after` takes it. */
export const isoOf = (seconds: number): string => new Date(seconds * 1000).toISOString()

/** A fresh window at a cutoff: what a read from `since` starts with, and what a gap restarts at. */
function windowAt(w: number, gapAnswered = false): Position {
  return { w, f: 0, a: [], k: [], d: [], P: [], g: gapAnswered }
}

function stateOf(position: Position): Record<string, unknown> {
  return {
    w: position.w,
    f: position.f,
    ...(position.n === undefined ? {} : { n: position.n }),
    ...(position.e === undefined ? {} : { e: position.e }),
    ...(position.a.length === 0 ? {} : { a: pack(position.a) }),
    ...(position.k.length === 0 ? {} : { k: pack(position.k) }),
    ...(position.d.length === 0 ? {} : { d: pack(position.d) }),
    ...(position.P.length === 0 ? {} : { P: position.P.map((group) => [group.e, pack(group.h)]) }),
    ...(position.g ? { g: 1 } : {}),
  }
}

/** A cursor for a position: the codec refuses one over 1,024 characters, which `maxCursorLength` proves cannot happen. */
export function cursorOf(search: string, position: Position): string {
  return encodeBoundCursor(bindingOf(search), stateOf(position))
}

/** A cursor that starts a window at `watermark` (an ISO time): the tests' way to name an old or a foreign cursor. */
export function cursorAt(search: string, watermark: string): string {
  return cursorOf(search, windowAt(secondsOf(Date.parse(watermark))))
}

/**
 * The longest this source's cursor can be: every field at its widest, the tail, CARRY hashes and MAX_GROUPS groups.
 * The search id does not count (the binding is a fixed-width hash). Packing rounds each of the seven lists up by
 * less than a character of JSON, so ten characters are added for however the hashes are split between them.
 * `encodeBoundCursor` refuses anything over 1,024, and a test pins this number.
 */
export function maxCursorLength(search: string): number {
  const hash = "ff".repeat(HASH_BYTES)
  const hashes = (count: number) => Array.from({ length: count }, () => hash)
  const grouped = CARRY - 2
  const groups = Array.from({ length: MAX_GROUPS }, (_, index) => ({ e: MAX_SECONDS, h: hashes(Math.floor(grouped / MAX_GROUPS) + (index < grouped % MAX_GROUPS ? 1 : 0)) }))
  return cursorOf(search, { w: MAX_SECONDS, f: MAX_OFFSET, n: MAX_SECONDS, e: MAX_SECONDS, a: hashes(TAIL), k: hashes(1), d: hashes(1), P: groups, g: true }).length + 10
}

/** The cursor budget, checked before any read: a page must never be fetched if its cursor could not be issued. */
function assertCursorFits(search: string): void {
  if (maxCursorLength(search) <= MAX_CURSOR_LENGTH) return
  refuse("UNAVAILABLE", "This source's cursor would be longer than the source contract allows, so the read was not made", "Report this: the plugin sizes its cursor against the contract's limit, and this is a bug.")
}

function invalid(what: string): never {
  refuse("CURSOR_INVALID", `The cursor ${what}`, "Start the read again with since, or with the previous result's cursor.")
}
const count = (value: unknown, max: number): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max
const unpack = (value: unknown, what: string): string[] => {
  if (value === undefined) return []
  const bytes = typeof value === "string" && BASE64URL.test(value) ? Buffer.from(value, "base64url") : undefined
  // Only the packing `pack` writes: whole hashes, and the one base64url spelling of their bytes.
  if (bytes === undefined || bytes.length % HASH_BYTES !== 0 || bytes.toString("base64url") !== value) invalid(`does not hold this source's ${what}`)
  return bytes!.toString("hex").match(new RegExp(`.{${HASH_BYTES * 2}}`, "g")) ?? []
}

function positionOf(cursor: string, search: string): Position {
  const decoded = decodeBoundCursor(bindingOf(search), cursor)
  if (!decoded.ok) invalid("is not this source's, this account's and this saved search's")
  const { state } = decoded as { state: Record<string, unknown> }
  const { w, f, n, e, g, P } = state
  if (!count(w, MAX_SECONDS) || !count(f, MAX_OFFSET)) invalid("does not hold this source's watermark and offset")
  for (const line of [n, e]) if (line !== undefined && !count(line, MAX_SECONDS)) invalid("does not hold this source's window lines")
  if (g !== undefined && g !== 1) invalid("does not hold this source's gap mark")
  const a = unpack(state["a"], "anchors")
  const k = unpack(state["k"], "listed companies")
  const d = unpack(state["d"], "re-seen companies")
  if (P !== undefined && (!Array.isArray(P) || P.length === 0 || P.length > MAX_GROUPS)) invalid("does not hold this source's earlier windows")
  const groups = ((P ?? []) as unknown[]).map((item): Group => {
    if (!Array.isArray(item) || item.length !== 2 || !count(item[0], MAX_SECONDS)) invalid("does not hold this source's earlier windows")
    const h = unpack((item as unknown[])[1], "earlier windows")
    if (h.length === 0) invalid("holds an empty earlier window")
    return { e: (item as number[])[0] as number, h }
  })
  const carried = k.length + d.length + groups.reduce((sum, group) => sum + group.h.length, 0)
  if (a.length > TAIL || carried > CARRY) invalid("carries more companies than this source ever does")
  // Inside a window (an offset past 0) the window's lines and its anchors are always there.
  if ((f as number) > 0 && (n === undefined || e === undefined || a.length === 0)) invalid("is inside a window but does not say where the window ends")
  if (n !== undefined && (n as number) < (w as number)) invalid("ends its window before it starts")
  return { w: w as number, f: f as number, ...(n === undefined ? {} : { n: n as number }), ...(e === undefined ? {} : { e: e as number }), a, k, d, P: groups, g: g === 1 }
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
 * The vendor page size for a caller's `limit`: never more than the caller asked for and never more than MAX_PAGE, so
 * a page's new companies always fit the page; from OVERLAP up, a multiple of it, so every offset a window reaches is
 * one the full overlap can be read before.
 */
export function pageSizeFor(limit: number): number {
  if (limit < OVERLAP) return Math.max(1, limit)
  return Math.min(MAX_PAGE, Math.floor(limit / OVERLAP) * OVERLAP)
}

/** The largest `limit` up to `most` that divides `offset`, so `page = offset / limit` addresses it exactly. */
function divisorOf(offset: number, most: number): number {
  for (let size = Math.min(most, offset); size > 1; size--) if (offset % size === 0) return size
  return 1
}

/** One vendor read: Specter's `page` and `limit`. */
export interface VendorRead {
  readonly page: number
  readonly limit: number
}

/**
 * The reads one call makes at `offset`: the page there, as large as the caller's limit allows and the offset divides,
 * and after the first page the overlap before it, read first. Together at most MAX_CALL_CREDITS companies.
 */
export function readsFor(offset: number, limit: number): { readonly main: VendorRead; readonly overlap?: VendorRead } {
  const size = pageSizeFor(limit)
  if (offset === 0) return { main: { page: 0, limit: size } }
  const main = divisorOf(offset, size)
  const overlap = divisorOf(offset, OVERLAP)
  return { overlap: { page: offset / overlap - 1, limit: overlap }, main: { page: offset / main, limit: main } }
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

/** One vendor page: the companies it returned, how many Specter returned (and charged), and when it was answered. */
interface VendorPage {
  readonly companies: CompanyRecord[]
  readonly returned: number
  readonly observedAt: string
  /** Epoch seconds at or before the answer: its `Date`, or the local clock pulled back. */
  readonly lower: number
  /** Epoch seconds after the answer: its `Date` + 1 s (the header's resolution), or the local clock pushed forward. */
  readonly upper: number
}

/** One page of the results endpoint, read with this source's inline budget, failing closed on a cut or bad body. */
async function vendorPage(read: Read, search: string, watermark: string, where: VendorRead, now: number): Promise<VendorPage> {
  let answer: ApiOutput
  try {
    answer = await read({
      method: "GET",
      path: `/searches/companies/${search}/results`,
      query: { new_results_after: watermark, page: where.page, limit: where.limit },
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
  const dated = answer.serverTime === undefined ? Number.NaN : Date.parse(answer.serverTime)
  const lower = Number.isFinite(dated) ? secondsOf(dated) : secondsOf(now - CLOCK_MARGIN_MS)
  const upper = Number.isFinite(dated) ? secondsOf(dated) + 1 : Math.ceil((now + CLOCK_MARGIN_MS) / 1000)
  return { companies: companiesOf(answer.data), returned: answer.itemsReturned ?? (Array.isArray(answer.data) ? answer.data.length : 0), observedAt: observation(answer, now), lower, upper }
}

/** What one company in a read is to the window: consumed before, carried from an earlier window, or new. */
interface Seen {
  readonly hash: string
  readonly kind: "window" | "pinned" | "new"
  readonly external?: string
}

/** The last `most` distinct hashes of a list, oldest first. */
function lastDistinct(list: readonly string[], most: number): string[] {
  const out: string[] = []
  for (let index = list.length - 1; index >= 0 && out.length < most; index--) if (!out.includes(list[index]!)) out.unshift(list[index]!)
  return out
}

/** Moves `hash` to the end of `list` when it is there: the list stays in the order its companies were last consumed. */
function touch(list: string[], hash: string): void {
  const index = list.indexOf(hash)
  if (index >= 0) list.push(...list.splice(index, 1))
}

/** Groups in time order, the two oldest merged until MAX_GROUPS remain: a merged group lives until its later line. */
function mergeGroups(groups: readonly Group[]): Group[] {
  const sorted = groups.filter((group) => group.h.length > 0).sort((x, y) => x.e - y.e)
  while (sorted.length > MAX_GROUPS) {
    const [first, second] = sorted.splice(0, 2) as [Group, Group]
    sorted.unshift({ e: second.e, h: [...first.h, ...second.h] })
  }
  return sorted
}

/**
 * The position inside CARRY. First to go are companies this window re-saw from earlier windows (needed by no later
 * window), then the middle of this window's own (its first and last consumed stay: the youngest companies are at one
 * end whichever way Specter orders them, and a forward shift brings the last back first), then the middle of the
 * earliest group, and only then the ends. Never `keep`, what a cut page must find again on its next call.
 */
function withinCarry(position: Position, keep: ReadonlySet<string>): Position {
  const k = [...position.k]
  const d = [...position.d]
  const groups = position.P.map((group) => ({ e: group.e, h: [...group.h] }))
  let carried = k.length + d.length + groups.reduce((sum, group) => sum + group.h.length, 0)
  /** Drops one company from `list`, skipping its first `head` and last `tail` and anything kept. */
  const dropFrom = (list: string[], head: number, tail: number): boolean => {
    for (let index = head; index < list.length - tail; index++) {
      if (keep.has(list[index]!)) continue
      list.splice(index, 1)
      carried--
      return true
    }
    return false
  }
  const passes: ((list: string[]) => boolean)[] = [(list) => dropFrom(list, HEAD, RECENT), (list) => dropFrom(list, 0, 0)]
  for (const pass of passes) {
    while (carried > CARRY && (pass(d) || pass(k) || groups.some((group) => pass(group.h)))) continue
  }
  return { ...position, k, d, P: groups.filter((group) => group.h.length > 0) }
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
  const position: Position = request.cursor === undefined ? windowAt(secondsOf(Math.min(startTime(request, options.now), options.now))) : positionOf(request.cursor, search)
  const held = await options.open()
  if (held === undefined) refuse("NEEDS_SIGN_IN", "No Specter team API key is connected, so the saved-search source cannot read", "Run /connect, choose Specter and paste the team API key from the API Console, then call events_list again.")
  const { read, owner } = held
  const nowIso = new Date(options.now).toISOString()

  // The 60-day window is checked before the call: a 422 would cost nothing but a round trip, and the answer must be
  // this source's own gap, never Specter's error. The restart is the earliest line Specter can still serve.
  const edge = secondsOf(options.now - RETENTION_MS + RESTART_GRACE_MS)
  if (position.w * 1000 < options.now - RETENTION_MS) return gapPage(search, position, owner, Math.max(position.w, edge), nowIso)

  const plan = readsFor(position.f, request.limit)
  const watermark = isoOf(position.w)
  let main: VendorPage
  let overlap: VendorPage | undefined
  try {
    // The overlap first, so a failure there risks its few credits rather than the page's.
    if (plan.overlap !== undefined) overlap = await vendorPage(read, search, watermark, plan.overlap, options.now)
    main = await vendorPage(read, search, watermark, plan.main, options.now)
  } catch (error) {
    // Specter's own retention 422 is the one gap it decides. Its clock, not the plugin's, said the watermark was too
    // old, so restart at the window's edge; only when the cursor is already at or past that edge (a clock more than
    // the grace behind Specter's) is nothing earlier known to be readable, and the restart is now.
    if (error instanceof SourceError && error.code === "CURSOR_EXPIRED") {
      return gapPage(search, position, owner, position.w < edge ? edge : secondsOf(options.now), nowIso)
    }
    throw error
  }
  const size = plan.main.limit
  const observedAt = main.observedAt
  // The next window's cutoff is fixed by this window's first read: anything added where the window has passed became
  // visible after that read, so it was added at or after this line (A2).
  const next = position.n ?? Math.max(position.w, main.lower - LOOKBACK_S)
  const last = Math.max(position.e ?? 0, main.upper, overlap?.upper ?? 0)
  const records = [...(overlap?.companies ?? []), ...main.companies.slice(0, size)]

  // Sort each company in the read: consumed by this window already, carried from an earlier window, or new.
  const consumedBefore = new Set([...position.a, ...position.k, ...position.d])
  const groupOf = new Map<string, number>()
  position.P.forEach((group, index) => {
    for (const hash of group.h) groupOf.set(hash, index)
  })
  const inRead = new Set<string>()
  const seen: Seen[] = []
  const fresh: CompanyRecord[] = []
  for (const company of records) {
    const hash = hashOf(company.id)
    if (consumedBefore.has(hash) || inRead.has(hash)) {
      seen.push({ hash, kind: "window" })
      continue
    }
    inRead.add(hash)
    if (groupOf.has(hash)) {
      seen.push({ hash, kind: "pinned" })
      continue
    }
    seen.push({ hash, kind: "new", external: `${EXTERNAL_PREFIX}${company.id}` })
    fresh.push(company)
  }
  // A read after the first is anchored when it holds a company this window consumed before: every company the window
  // has not reached sorts after that one (A1), so inside or beyond this read. Without one, more companies left before
  // the offset than the overlap covers, and one may have been skipped.
  const anchored = position.f === 0 || records.some((company) => consumedBefore.has(hashOf(company.id)))

  // Everything on a page became visible by this read, so each event's occurred_at is this read's observation time.
  const screened = screenEvents(fresh.map((company) => toEvent(company, observedAt)))
  const fits = fitPage(screened.events, request.limit, MAX_BYTES)
  const page = screened.events.slice(0, fits)
  // The page stops before the first event that does not fit: every company before it is consumed, none after it.
  const firstOut = screened.events[fits]?.external_id
  const stop = firstOut === undefined ? seen.length : seen.findIndex((item) => item.external === firstOut)
  const cut = stop < seen.length
  const consumed = seen.slice(0, stop)
  const consumedNow = new Set(consumed.map((item) => item.hash))
  const refused = screened.refused.filter((item) => consumedNow.has(hashOf(item.external_id.slice(EXTERNAL_PREFIX.length))))

  const k = [...position.k]
  const d = [...position.d]
  const groups = position.P.map((group) => ({ e: group.e, h: [...group.h] }))
  for (const item of consumed) {
    if (item.kind === "new") k.push(item.hash)
    else if (item.kind === "window") {
      touch(k, item.hash)
      touch(d, item.hash)
    } else {
      // An earlier window's company the next window cannot read again is kept for this window only.
      const group = groups[groupOf.get(item.hash)!]!
      if (group.e < next) {
        group.h.splice(group.h.indexOf(item.hash), 1)
        d.push(item.hash)
      }
    }
  }
  // The tail is the companies just before the next call's offset, by position: unchanged by a cut page (its offset
  // holds), else the end of this read.
  const tail = cut ? [...position.a] : lastDistinct([...position.a, ...seen.map((item) => item.hash)], TAIL)

  const full = main.returned >= size
  const offset = cut ? position.f : position.f + size
  // A window past ten million companies ends there, and says so: nothing that large is expected in 60 days.
  const exhausted = !cut && full && offset > MAX_OFFSET
  const done = (!cut && !full) || exhausted
  const truncated = !anchored || exhausted
  const gap = truncated && !position.g ? { reason: "window-truncated" as const, since: watermark } : undefined

  let state: Position
  if (done) {
    // The next window starts at `next`. A group stays while its companies may still be added at or after that line;
    // this window's new companies join as one more group; what this window re-saw for itself is dropped.
    const pinned = [...groups, ...(k.length === 0 ? [] : [{ e: last, h: k }])].filter((group) => group.e >= next)
    state = withinCarry({ ...windowAt(next), P: mergeGroups(pinned) }, new Set())
  } else {
    state = withinCarry({ w: position.w, f: offset, n: next, e: last, a: tail, k, d, P: groups, g: position.g || gap !== undefined }, cut ? new Set(seen.map((item) => item.hash)) : new Set())
  }
  let cursor: string
  try {
    cursor = cursorOf(search, state)
  } catch (error) {
    // The budget was checked before the read, so this is a bug, not a full page: refuse rather than throw a plain Error
    // whose page the consumer could not resume from.
    refuse("UNAVAILABLE", `This source's cursor could not be issued (${error instanceof Error ? error.message : "an unknown error"})`, "Report this: the plugin sizes its cursor against the contract's limit, and this is a bug.")
  }
  const cost = costOf(main.returned + (overlap?.returned ?? 0))
  return eventsListResult(
    { source: SOURCE, account: ACCOUNT, owner },
    page,
    cursor,
    !done,
    {
      scope: { [SCOPE_KEY]: search },
      ...(gap === undefined ? {} : { gap }),
      ...(refused.length > 0 ? { refused } : {}),
      ...(cost === undefined ? {} : { cost }),
      plugin: PACKAGE,
      asOf: observedAt,
    },
  )
}

/**
 * The page that answers a gap: no events, `gap.reason: "expired"` and the lost window's start, and `more: true` so the
 * consumer reads on at once from a line Specter can still serve — the earliest readable one, carried in the cursor.
 * It is answered once: the cursor it answers carries a fresh watermark and the gap mark, so no later page of the read
 * repeats it.
 */
function gapPage(search: string, position: Position, owner: EventsOwner, restart: number, nowIso: string): EventsListResult {
  return eventsListResult({ source: SOURCE, account: ACCOUNT, owner }, [], cursorOf(search, windowAt(restart, true)), true, {
    scope: { [SCOPE_KEY]: search },
    gap: { reason: "expired", since: isoOf(position.w) },
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

