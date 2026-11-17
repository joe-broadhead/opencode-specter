// The key check on a fake transport: one free GET of the credit balance, the key only in X-API-Key, and each answer
// read as Specter's public docs describe it. No request leaves the process.
import { describe, expect, it } from "vitest"
import { API_KEY_HEADER, REST_BASE } from "../../src/constants.js"
import { checkKey, KEY_CHECK_PATH, KEY_RECHECK_MS, keyChecker } from "../../src/key-check.js"
import { DUMMY_KEY } from "./fake.js"

type Sent = { url: string; init: RequestInit }

function transport(answer: () => Response | Promise<Response>) {
  const sent: Sent[] = []
  const fetcher = (async (url: string, init: RequestInit) => {
    sent.push({ url, init })
    return answer()
  }) as unknown as typeof fetch
  return { sent, fetcher }
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("the key check", () => {
  it("asks the free credit balance once, with the key only in X-API-Key, and follows no redirect", async () => {
    const { sent, fetcher } = transport(() => json({ credit_limit: 1, used: 0, remaining: 1, unlimited: false }, 200))
    expect(await checkKey(DUMMY_KEY, fetcher)).toBe("accepted")
    expect(sent).toHaveLength(1)
    expect(sent[0]!.url).toBe(`${REST_BASE}${KEY_CHECK_PATH}`)
    expect(sent[0]!.url).toBe("https://app.tryspecter.com/api/v1/organization/credits")
    expect(sent[0]!.init.method).toBe("GET")
    expect(sent[0]!.init.redirect).toBe("manual")
    const headers = sent[0]!.init.headers as Record<string, string>
    expect(Object.entries(headers).filter(([, value]) => value.includes(DUMMY_KEY)).map(([name]) => name)).toEqual([API_KEY_HEADER])
  })

  it("reads each answer as Specter's docs describe it", async () => {
    // Each answer is made fresh per case: a cloned Response's body cannot be cancelled while its twin is unread.
    const cases: [() => Response | Error, string][] = [
      [() => json({}, 200), "accepted"],
      [() => json({ errorCode: "OUT_OF_CREDITS", message: "x" }, 402), "accepted"],
      [() => json({ errorCode: "API_KEY_NOT_VALID", message: "x" }, 401), "rejected"],
      [() => json({ errorCode: "API_KEY_MISSING", message: "x" }, 401), "rejected"],
      [() => json({ errorCode: "api_access_not_granted", message: "x" }, 403), "rejected"],
      [() => json({ errorCode: "org_key_disabled", message: "x" }, 403), "rejected"],
      // A valid key whose plan lacks the endpoint.
      [() => json({ errorCode: "NOT_PERMITTED", message: "x" }, 403), "accepted"],
      // Any other 403 says neither: an unknown code, no code, or a page that is not Specter's error object.
      [() => json({ errorCode: "SOMETHING_ELSE", message: "x" }, 403), "unconfirmed"],
      [() => json({ message: "no code" }, 403), "unconfirmed"],
      [() => new Response("<html>Forbidden by a proxy</html>", { status: 403, headers: { "content-type": "text/html" } }), "unconfirmed"],
      [() => json({ errorCode: "NOT_PERMITTED", message: "x".repeat(20_000) }, 403), "unconfirmed"],
      [() => json({ errorCode: "RATE_LIMITED", message: "x" }, 429), "unchecked"],
      [() => json({ errorCode: "clerk_unavailable", message: "x" }, 503), "unchecked"],
      [() => new Response(null, { status: 302, headers: { location: "https://elsewhere.example.invalid/" } }), "unchecked"],
      [() => new Error("socket hang up"), "unchecked"],
    ]
    for (const [make, expected] of cases) {
      const answer = make()
      const { fetcher } = transport(() => (answer instanceof Error ? Promise.reject(answer) : answer))
      expect(await checkKey(DUMMY_KEY, fetcher), answer instanceof Error ? answer.message : String(answer.status)).toBe(expected)
    }
  })

  it("reads no more than 16 KB of a 403 body", async () => {
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        controller.enqueue(new Uint8Array(8_192).fill(32))
        if (pulled > 100) controller.close()
      },
    })
    const { fetcher } = transport(() => new Response(body, { status: 403 }))
    expect(await checkKey(DUMMY_KEY, fetcher)).toBe("unconfirmed")
    expect(pulled).toBeLessThanOrEqual(4)
  })

  it("checks each key once, asks again after an unchecked answer, and shows only that key's standing answer", async () => {
    let status = 503
    const { sent, fetcher } = transport(() => json({}, status))
    const keys = keyChecker(fetcher)
    expect(await keys.check(DUMMY_KEY)).toBe("unchecked")
    expect(keys.last(DUMMY_KEY)).toBe("unchecked")
    status = 200
    expect(await keys.check(DUMMY_KEY)).toBe("accepted")
    expect(await keys.check(DUMMY_KEY)).toBe("accepted")
    expect(sent).toHaveLength(2)
    expect(keys.last(DUMMY_KEY)).toBe("accepted")
    // Another key: its own check, and the first key's answer is never shown for it.
    const other = `${DUMMY_KEY}-other`
    expect(keys.last(other)).toBe("unchecked")
    status = 401
    const pending = keys.check(other)
    expect(keys.last(other)).toBe("unchecked")
    expect(await pending).toBe("rejected")
    expect(keys.last(other)).toBe("rejected")
    expect(sent).toHaveLength(3)
  })

  it("asks again once an answer is KEY_RECHECK_MS old, so a key revoked at Specter shows as rejected without a restart", async () => {
    let clock = 0
    let status = 200
    const { sent, fetcher } = transport(() => json({}, status))
    const keys = keyChecker(fetcher, undefined, () => clock)
    expect(await keys.check(DUMMY_KEY)).toBe("accepted")
    clock = KEY_RECHECK_MS - 1
    status = 401
    expect(await keys.check(DUMMY_KEY)).toBe("accepted")
    expect(sent).toHaveLength(1)
    clock = KEY_RECHECK_MS
    // Stale: status no longer shows the old answer while the new one is pending.
    expect(keys.last(DUMMY_KEY)).toBe("unchecked")
    expect(await keys.check(DUMMY_KEY)).toBe("rejected")
    expect(keys.last(DUMMY_KEY)).toBe("rejected")
    expect(sent).toHaveLength(2)
  })
})
