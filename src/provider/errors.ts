// A failure from Specter's REST API, as one of the contract's codes and the next step a person reads. The plugin's own
// words only: Specter's `message` is upstream text, so it stays in a result's data (marked untrusted) and never reaches
// an error, a status line or a log line. A request ID and Specter's `errorCode` are safe to name: both are checked to be
// a plain code or id first.
import type { ApiOutput } from "./request.js"
import { API_CONSOLE_URL, SUPPORT_EMAIL } from "./endpoints.js"

/** The contract codes a Specter failure maps to. */
export type ProviderCode = "NEEDS_SIGN_IN" | "RATE_LIMITED" | "BUDGET_EXCEEDED" | "CURSOR_EXPIRED" | "CURSOR_INVALID" | "INPUT_INVALID" | "SOURCE_UNKNOWN" | "TOO_LARGE" | "UNAVAILABLE"

/**
 * A refusal from the provider layer. It carries `code`, `what` and `next` in the contract's form, so `register` maps it
 * to the same code rather than folding it into UNAVAILABLE.
 */
export class ProviderError extends Error {
  readonly code: ProviderCode
  /** What happened, without the code or the next step. */
  readonly what: string
  readonly next: string
  /** For a RATE_LIMITED answer: the wait Specter named, in seconds. */
  readonly retryAfterSec?: number
  /** For CURSOR_EXPIRED: the earliest line Specter still serves. */
  readonly since?: string

  constructor(init: { readonly code: ProviderCode; readonly what: string; readonly next: string; readonly retryAfterSec?: number; readonly since?: string }) {
    const what = init.what.replace(/[.\s]+$/, "")
    super(`${init.code}: ${what}. Next step: ${init.next}`)
    this.name = "ProviderError"
    this.code = init.code
    this.what = what
    this.next = init.next
    if (init.retryAfterSec !== undefined) this.retryAfterSec = init.retryAfterSec
    if (init.since !== undefined) this.since = init.since
  }
}

export function refuse(code: ProviderCode, what: string, next: string, extra: { readonly retryAfterSec?: number; readonly since?: string } = {}): never {
  throw new ProviderError({ code, what, next, ...extra })
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Specter's `errorCode`, only when it looks like a code: never free text. */
export function errorCodeOf(body: unknown): string | undefined {
  const code = record(body) ? body["errorCode"] : undefined
  return typeof code === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(code) ? code : undefined
}

/** X-Request-ID, only when it looks like an ID (Specter sends a UUID, or echoes the caller's). */
export function requestIdOf(headers: Headers): string | undefined {
  const id = headers.get("x-request-id")?.trim()
  return id && /^[A-Za-z0-9._:-]{1,128}$/.test(id) ? id : undefined
}

/** A header's value as a non-negative finite number (a count, or seconds), or undefined. */
export function headerNumber(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name)
  if (raw === null || raw.trim() === "") return undefined
  const seconds = Number(raw)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined
}

/** The 403 codes that refuse a member's key itself, rather than one endpoint. */
const KEY_REFUSALS: ReadonlySet<string> = new Set(["user_suspended", "api_access_not_granted", "org_key_disabled", "member_keys_disabled", "member_keys_admins_only"])

const reportWith = (requestId: string | undefined) => (requestId ? ` If it keeps happening, email ${SUPPORT_EMAIL} with the request ID ${requestId}.` : ` If it keeps happening, email ${SUPPORT_EMAIL}.`)
const keyStep = `Run /connect, choose "Specter team API key" and paste a current key from Specter's API Console (${API_CONSOLE_URL}), then try again.`

/**
 * A failed answer as the contract's refusal. Specter's documented answers (from its public reference, not yet confirmed
 * against live responses): 401 and the key-refusing 403s are NEEDS_SIGN_IN; 402 is the provider's own limit, so
 * RATE_LIMITED with the wait Specter named; a retention 422 is CURSOR_EXPIRED; other 400/404/422 answers are
 * INPUT_INVALID; 429 is RATE_LIMITED; a 5xx is UNAVAILABLE.
 */
export function failureOf(answer: ApiOutput): ProviderError {
  const code = answer.error?.errorCode
  const said = code === undefined ? "" : ` (${code})`
  const waitSeconds = answer.credits?.resetSeconds ?? answer.rateLimit?.resetSeconds
  const retryAfterSec = waitSeconds === undefined ? undefined : Math.max(1, Math.ceil(waitSeconds))
  const extra = retryAfterSec === undefined ? {} : { retryAfterSec }
  if (answer.status === 401 || (answer.status === 403 && code !== undefined && KEY_REFUSALS.has(code))) {
    return new ProviderError({ code: "NEEDS_SIGN_IN", what: `Specter refused the team API key with HTTP ${answer.status}${said}`, next: keyStep })
  }
  if (answer.status === 403) {
    return code === "NOT_PERMITTED"
      ? new ProviderError({ code: "UNAVAILABLE", what: `Specter answered HTTP 403${said}: the key is valid, but the team's plan does not include this endpoint`, next: `Ask Specter's support about API access to it.${reportWith(answer.requestId)}` })
      : new ProviderError({ code: "NEEDS_SIGN_IN", what: `Specter refused the team API key with HTTP 403${said}`, next: keyStep })
  }
  if (answer.status === 402) {
    return new ProviderError({
      code: "RATE_LIMITED",
      what: code === "DAILY_CREDIT_CAP_REACHED" ? "Specter stopped the read: the organisation's daily credit limit is reached" : `Specter stopped the read: the team's credit budget for this period is spent${said}`,
      next: "Wait for the credits to renew, then try again; an admin can ask Specter's support for more.",
      ...extra,
    })
  }
  if (answer.status === 404) {
    return new ProviderError({ code: "INPUT_INVALID", what: "Specter knows no record with that id, or it is not shared with the API", next: "Check the id against the free saved-search list, or the id a search returned, then try again." })
  }
  if (answer.status === 422 && code === "NEW_RESULTS_AFTER_BEYOND_RETENTION") {
    return new ProviderError({
      code: "CURSOR_EXPIRED",
      what: "Specter answered HTTP 422: it tracks additions to a saved search for 60 days, and the cursor's watermark is older",
      next: "The source answers a gap and restarts from the earliest line Specter can still serve; call events_list again with the cursor it answered.",
      ...(answer.serverTime === undefined ? {} : { since: answer.serverTime }),
    })
  }
  if (answer.status === 400 || answer.status === 422) {
    return new ProviderError({
      code: "INPUT_INVALID",
      what: code === "NOT_SUPPORTED_PRODUCT" ? "Specter answered HTTP 400: that saved search is not a company search" : `Specter refused the read's parameters with HTTP ${answer.status}${said}`,
      next: "Check the input against the tool's schema, and use a saved company search.",
    })
  }
  if (answer.status === 429) {
    return new ProviderError({ code: "RATE_LIMITED", what: `Specter's rate limit stopped the read with HTTP 429${said}`, next: "Wait, then try again: the limit is 15 requests a second per team key.", ...extra })
  }
  return new ProviderError({
    code: "UNAVAILABLE",
    what: `Specter answered HTTP ${answer.status}${said}${answer.requestId === undefined ? "" : ` (request ID ${answer.requestId})`}`,
    next: `Wait a minute, then try again.${reportWith(answer.requestId)}`,
    ...extra,
  })
}

/** The free balance read that names a valid key even when its credits are spent: 402 is a valid key's answer. */
export function keyAccepted(answer: ApiOutput): boolean {
  return answer.ok || answer.status === 402
}
