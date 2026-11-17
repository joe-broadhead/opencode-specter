/**
 * Whether Specter accepts the team key, asked of a free endpoint, in opencode-tavily's shape (Tavily asks
 * `GET /usage`): one request with a 5 s timeout, never throws, follows no redirect, and nothing it returns or logs
 * contains the key.
 *
 * The endpoint is `GET /organization/credits`, the credit balance. From Specter's public docs, unverified live
 * (https://api.tryspecter.com/api-reference/account/get-credit-balance.md): it costs no credits, stays readable when
 * the budget is spent, and answers 401 for a missing or invalid key (API_KEY_MISSING, API_KEY_NOT_VALID,
 * key_from_another_org) and 403 for a key it refuses or an endpoint the plan lacks. So:
 * - 200, or 402 (a valid key whose credits are spent): `accepted`;
 * - 401, or a 403 whose errorCode refuses the key itself: `rejected`;
 * - 403 NOT_PERMITTED: `accepted`, because Specter documents it as "the key is valid, but your plan doesn't include
 *   this endpoint";
 * - anything else (429, 5xx, a redirect, a network failure or a timeout): `unchecked`.
 * TODO(Slice 5): confirm these answers with a live key, then the `needs_auth` mark on /connect after a rejected key.
 */
import { API_KEY_HEADER, REST_BASE } from "./constants.js"
import { errorCodeOf, KEY_REFUSALS } from "./api/specter-error.js"

/** `unchecked`: Specter could not be asked, or gave an answer that says nothing about the key. */
export type KeyCheck = "accepted" | "rejected" | "unchecked"

export type KeyChecker = (key: string) => Promise<KeyCheck>

export const KEY_CHECK_TIMEOUT_MS = 5_000
/** The free endpoint the check asks, relative to the REST base. */
export const KEY_CHECK_PATH = "/organization/credits"

/** Most bytes read of an error body: Specter's error objects are small. */
const MAX_ERROR_BYTES = 16_384

/** Asks Specter whether it accepts `key`. Never throws. `base` is REST_BASE unless a test points at a fake. */
export async function checkKey(key: string, fetcher: typeof fetch = fetch, base: string = REST_BASE): Promise<KeyCheck> {
  try {
    const response = await fetcher(`${base.replace(/\/$/, "")}${KEY_CHECK_PATH}`, {
      method: "GET",
      headers: { Accept: "application/json", "User-Agent": "opencode-specter", [API_KEY_HEADER]: key },
      redirect: "manual",
      signal: AbortSignal.timeout(KEY_CHECK_TIMEOUT_MS),
    })
    if (response.status === 403) {
      const code = errorCodeOf(await smallJson(response))
      return code !== undefined && KEY_REFUSALS.has(code) ? "rejected" : "accepted"
    }
    await response.body?.cancel().catch(() => undefined)
    if (response.status === 200 || response.status === 402) return "accepted"
    return response.status === 401 ? "rejected" : "unchecked"
  } catch {
    return "unchecked"
  }
}

/** A small JSON body, or undefined: the check reads only Specter's errorCode. */
async function smallJson(response: Response): Promise<unknown> {
  const text = await response.text()
  if (text.length > MAX_ERROR_BYTES) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Checks each key once. A check that ends `unchecked` runs again on the next call, so a passing outage clears. */
export function keyChecker(fetcher: typeof fetch = fetch, base: string = REST_BASE): KeyChecker {
  let current: { readonly key: string; readonly result: Promise<KeyCheck> } | undefined
  return (key) => {
    if (current?.key !== key) current = { key, result: checkKey(key, fetcher, base) }
    const mine = current
    return mine.result.then((result) => {
      if (result === "unchecked" && current === mine) current = undefined
      return result
    })
  }
}
