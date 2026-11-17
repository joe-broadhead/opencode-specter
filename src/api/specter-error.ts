// Specter's REST error object, mapped to the plugin's codes and one next step each, in the shape of opencode-tavily's
// src/tavily-error.ts. Every fact here is from Specter's public docs, unverified live (Slice 0 confirms them with a
// key): https://api.tryspecter.com/api-ref/errors.md, https://api.tryspecter.com/api-ref/rate_limits.md and the
// OpenAPI responses of https://api.tryspecter.com/api-ref/openapi.json.
//
// - Every error is JSON `{ "errorCode": "<CODE>", "message": "<text>" }`.
// - 401: the key is missing or not valid (API_KEY_MISSING, API_KEY_NOT_VALID, key_from_another_org).
// - 403: NOT_PERMITTED, the key is valid but the plan does not include the endpoint; the other 403 codes
//   (user_suspended, api_access_not_granted, org_key_disabled, member_keys_disabled, member_keys_admins_only) are the
//   reasons a member's `ak_` key is refused.
// - 402 is always "stop", in two kinds: OUT_OF_CREDITS (the monthly budget is spent) and DAILY_CREDIT_CAP_REACHED (the
//   organisation's daily limit; X-CreditLimit-Daily-Reset gives the wait in seconds, and it resets at 00:00 UTC).
// - 422: VALIDATION_ERROR, or NEW_RESULTS_AFTER_BEYOND_RETENTION when a saved search's `new_results_after` is older
//   than the 60 days Specter tracks additions for.
// - 429: RATE_LIMITED, 15 requests a second per key; X-RateLimit-Reset is the seconds until the window resets.
// - 503: clerk_unavailable, a member key could not be checked; Retry-After is the wait in seconds.
// - Retry only 429 and 5xx; never 400, 401, 403, 404 or 422; stop on 402. 400 and 5xx are not charged.
// - Every response carries X-Request-ID, which Specter's support asks for in a report.
//
// Specter's `message` is upstream text: it stays in the result's data, which is marked untrusted, and never reaches
// the plugin's error, which carries only the status, Specter's `errorCode` (checked to be a plain code), the request
// ID (checked to be a plain ID) and the plugin's own words.
import type { PluginCode } from "../constants.js"
import type { ToolClass } from "../specter-tools.js"

/** Specter's support address, for reports that need a request ID. */
export const SPECTER_SUPPORT = "api-support@tryspecter.com"

/** Specter's `errorCode` values this file names, from its public docs. Not the plugin's own codes. */
export const SPECTER_ERROR_CODES = [
  "API_KEY_MISSING",
  "API_KEY_NOT_VALID",
  "NOT_PERMITTED",
  "OUT_OF_CREDITS",
  "DAILY_CREDIT_CAP_REACHED",
  "VALIDATION_ERROR",
  "NEW_RESULTS_AFTER_BEYOND_RETENTION",
  "RATE_LIMITED",
] as const

/** The 403 codes that refuse a member's `ak_` key itself, rather than one endpoint. */
const KEY_REFUSALS = new Set(["user_suspended", "api_access_not_granted", "org_key_disabled", "member_keys_disabled", "member_keys_admins_only"])

/** What the plugin makes of one failed response. */
export interface SpecterError {
  readonly status: number
  /** The plugin's code: a specific one where Specter's answer tells the case apart, else UPSTREAM_ERROR. */
  readonly code: Extract<PluginCode, "KEY_REJECTED" | "OUT_OF_CREDITS" | "DAILY_CREDIT_CAP_REACHED" | "UPSTREAM_ERROR">
  /** Specter's `errorCode`, when it is a plain code. */
  readonly errorCode?: string
  /** X-Request-ID, when it is a plain ID. */
  readonly requestId?: string
  /** What happened, in the plugin's words, one sentence. */
  readonly message: string
  readonly next: string
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value)

/** Specter's `errorCode` from a body, only when it looks like a code: never free text. */
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

const wait = (seconds: number | undefined, otherwise: string) => (seconds === undefined ? otherwise : `${Math.max(1, Math.ceil(seconds))} seconds`)
const reportWith = (requestId: string | undefined) =>
  requestId ? ` If it keeps happening, email ${SPECTER_SUPPORT} with the request ID ${requestId}.` : ` If it keeps happening, email ${SPECTER_SUPPORT}.`

/** The plugin's reading of a failed response's status, body and headers. */
export function specterErrorOf(status: number, body: unknown, headers: Headers, toolClass: ToolClass): SpecterError {
  const errorCode = errorCodeOf(body)
  const requestId = requestIdOf(headers)
  const base = { status, ...(errorCode ? { errorCode } : {}), ...(requestId ? { requestId } : {}) }
  const said = errorCode ? ` (${errorCode})` : ""
  if (status === 401 || (status === 403 && errorCode !== undefined && KEY_REFUSALS.has(errorCode))) {
    return {
      ...base,
      code: "KEY_REJECTED",
      message: `Specter refused the team API key with HTTP ${status}${said}.`,
      next: "Run /connect, choose Specter and paste a current key from Specter's API Console (https://app.tryspecter.com/settings/api-console), then run /specter-status.",
    }
  }
  if (status === 402) {
    if (errorCode === "DAILY_CREDIT_CAP_REACHED") {
      return {
        ...base,
        code: "DAILY_CREDIT_CAP_REACHED",
        message: "Specter stopped the call: your organisation's daily credit limit is reached.",
        next: `Wait ${wait(headerNumber(headers, "x-creditlimit-daily-reset"), "until 00:00 UTC")}, then try again; an admin can ask ${SPECTER_SUPPORT} to change the limit.`,
      }
    }
    const renew = headerNumber(headers, "x-creditlimit-reset")
    return {
      ...base,
      code: "OUT_OF_CREDITS",
      message: `Specter stopped the call: the team's credit budget for this period is spent${said}.`,
      next: `Wait for the period to renew${renew === undefined ? "" : `, in ${wait(renew, "")}`}, or ask ${SPECTER_SUPPORT} for more credits; calls that spend credits fail until then.`,
    }
  }
  const upstream = (message: string, next: string): SpecterError => ({ ...base, code: "UPSTREAM_ERROR", message, next })
  if (status === 403) return upstream(`Specter answered with HTTP 403${said}: the key is valid, but the team's Specter plan does not include this endpoint.`, `Ask ${SPECTER_SUPPORT} about access to it.`)
  if (status === 404) return upstream(`Specter answered with HTTP 404${said}.`, "Specter answers 404 for a wrong path or an id it does not know. Check the input.")
  if (status === 422 && errorCode === "NEW_RESULTS_AFTER_BEYOND_RETENTION") {
    return upstream(`Specter answered with HTTP 422${said}: it tracks additions to a saved search for 60 days, and the cutoff is older.`, "Read the saved search again with a cutoff within the last 60 days, or without one.")
  }
  if (status === 429) {
    const seconds = headerNumber(headers, "x-ratelimit-reset") ?? headerNumber(headers, "retry-after")
    return upstream(`Specter's rate limit stopped this call with HTTP 429${said}.`, `Wait ${wait(seconds, "a few seconds")}, then try again, and make fewer calls at once: the limit is per team key.`)
  }
  if (status >= 500) {
    const message = `Specter answered with HTTP ${status}${said}, a problem on its side.`
    return toolClass === "spend"
      ? upstream(message, `This call was not retried, because it may already have spent credits: check before you call it again.${reportWith(requestId)}`)
      : upstream(message, `Wait a minute, then try again.${reportWith(requestId)}`)
  }
  return upstream(`Specter answered with HTTP ${status}${said}.`, "Check the input against the tool's schema, then call it again.")
}
