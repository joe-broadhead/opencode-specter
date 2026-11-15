/**
 * Whether Specter accepts the team key, asked of a free endpoint, in opencode-tavily's shape (Tavily asks
 * `GET /usage`): a 5 s timeout, never throws, and nothing it returns or logs contains the key.
 *
 * A stub. TODO(Slice 0, Slice 5): Specter's free endpoint for this check is not known. Slice 0 finds a balance or
 * account endpoint in the API reference and confirms by hand that it costs no credits; Slice 5 sends the check there,
 * with the key in X-API-Key, and maps 401 and 403 to `rejected`. Until then every check is `unchecked`, and nothing is
 * sent.
 */

/** `unchecked`: Specter could not be asked, or gave an answer that says nothing about the key. */
export type KeyCheck = "accepted" | "rejected" | "unchecked"

export type KeyChecker = (key: string) => Promise<KeyCheck>

export const KEY_CHECK_TIMEOUT_MS = 5_000

/** TODO(Slice 5): ask the free endpoint found in Slice 0. */
export async function checkKey(_key: string, _fetcher: typeof fetch = fetch): Promise<KeyCheck> {
  return "unchecked"
}

/** Checks each key once. A check that ends `unchecked` runs again on the next call, so a passing outage clears. */
export function keyChecker(fetcher: typeof fetch = fetch): KeyChecker {
  let current: { readonly key: string; readonly result: Promise<KeyCheck> } | undefined
  return (key) => {
    if (current?.key !== key) current = { key, result: checkKey(key, fetcher) }
    const mine = current
    return mine.result.then((result) => {
      if (result === "unchecked" && current === mine) current = undefined
      return result
    })
  }
}
