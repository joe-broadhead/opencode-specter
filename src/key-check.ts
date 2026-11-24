/**
 * Whether Specter accepts the team key, asked of a free endpoint, in opencode-tavily's shape (Tavily asks
 * `GET /usage`): one request with a 5 s timeout, never throws, follows no redirect, reads at most 16 KB of an error
 * body, and nothing it returns or logs contains the key.
 *
 * The endpoint is `GET /organization/credits`, the credit balance. From Specter's public docs, not yet confirmed
 * against live responses (https://api.tryspecter.com/api-reference/account/get-credit-balance.md): it costs no
 * credits, stays readable when the budget is spent, and answers 401 for a missing or invalid key (API_KEY_MISSING,
 * API_KEY_NOT_VALID, key_from_another_org) and 403 for a key it refuses or an endpoint the plan lacks. So:
 * - 200, or 402 (a valid key whose credits are spent): `accepted`;
 * - 401, or a 403 whose errorCode refuses the key itself: `rejected`;
 * - 403 NOT_PERMITTED: `accepted`, because Specter documents it as "the key is valid, but your plan doesn't include
 *   this endpoint";
 * - any other 403, such as one without Specter's error object (a proxy's page): `unconfirmed`, an answer that says
 *   neither;
 * - anything else (429, 5xx, a redirect, a network failure or a timeout): `unchecked`.
 */
import { errorCodeOf, KEY_REFUSALS } from "./api/specter-error.js"
import { API_KEY_HEADER, REST_BASE } from "./constants.js"
import { isLoopback, vendorCallsAllowed } from "./release.js"

/**
 * `unconfirmed`: Specter answered, but not in a way that says whether it accepts the key. `unchecked`: Specter could
 * not be asked, gave a passing failure, or has not answered for this key yet.
 */
export type KeyCheck = "accepted" | "rejected" | "unconfirmed" | "unchecked"

export const KEY_CHECK_TIMEOUT_MS = 5_000
/** The free endpoint the check asks, relative to the REST base. */
export const KEY_CHECK_PATH = "/organization/credits"
/** How long an answer stands before the key is asked about again: a key revoked at Specter shows within this. */
export const KEY_RECHECK_MS = 10 * 60_000
/** Most bytes read of an error body: Specter's error objects are small. */
const MAX_ERROR_BYTES = 16_384

/** Asks Specter whether it accepts `key`. Never throws. `base` is REST_BASE unless a test points at a fake. */
export async function checkKey(key: string, fetcher: typeof fetch = fetch, base: string = REST_BASE, released = false): Promise<KeyCheck> {
  try {
    const target = new URL(base)
    // The live fetch is the vendor. A source install sends nothing; a test's fetcher or a loopback fake still runs.
    if (fetcher === fetch && !isLoopback(target) && !(await vendorCallsAllowed({ released }))) return "unchecked"
    const response = await fetcher(`${base.replace(/\/$/, "")}${KEY_CHECK_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "specter-plugin", [API_KEY_HEADER]: key },
      redirect: "manual",
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })
    if (response.status === 403) {
      const code = errorCodeOf(await smallJson(response))
      if (code === "NOT_PERMITTED") return "accepted"
      return code !== undefined && KEY_REFUSALS.has(code) ? "rejected" : "unconfirmed"
    }
    await response.body?.cancel().catch(() => undefined)
    if (response.status === 200 || response.status === 402) return "accepted"
    return response.status === 401 ? "rejected" : "unchecked"
  } catch {
    return "unchecked"
  }
}

/** A JSON body of at most MAX_ERROR_BYTES, or undefined; a longer body is not read past the cap. */
async function smallJson(response: Response): Promise<unknown> {
  if (!response.body) return undefined
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > MAX_ERROR_BYTES) return undefined
      chunks.push(value)
    }
  } finally {
    await reader.cancel().catch(() => undefined)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } catch {
    return undefined
  }
}

export interface KeyChecker {
  /** Asks about `key` unless a standing answer for it exists; returns that answer. */
  check(key: string): Promise<KeyCheck>
  /**
   * The standing answer for `key`, without a request: `unchecked` for another key, an answer older than
   * KEY_RECHECK_MS, or one not in yet. Status shows this, so it never shows one key's answer for another.
   */
  last(key: string): KeyCheck
}

/**
 * Checks each key once, and again once its answer is KEY_RECHECK_MS old, so a key revoked at Specter shows as
 * rejected without a restart. An `unchecked` answer is not kept: the next call asks again, so a passing outage clears.
 */
export function keyChecker(fetcher: typeof fetch = fetch, base: string = REST_BASE, now: () => number = Date.now): KeyChecker {
  let current: { readonly key: string; readonly result: Promise<KeyCheck>; settled?: KeyCheck; at?: number } | undefined
  const fresh = (key: string) => current?.key === key && (current.at === undefined || now() - current.at < KEY_RECHECK_MS)
  return {
    check(key) {
      if (!fresh(key)) {
        const mine: NonNullable<typeof current> = {
          key,
          result: checkKey(key, fetcher, base).then((result) => {
            if (current === mine) {
              if (result === "unchecked") current = undefined
              else Object.assign(mine, { settled: result, at: now() })
            }
            return result
          }),
        }
        current = mine
      }
      return current!.result
    },
    last(key) {
      return fresh(key) && current?.settled !== undefined ? current.settled : "unchecked"
    },
  }
}
