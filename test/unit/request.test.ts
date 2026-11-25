import { describe, expect, test } from "vitest"
import { ProviderError } from "../../src/provider/errors.js"
import { backoff, jitter, onRestBase, request, restTarget, retryWait, type Fetch, type RestInput } from "../../src/provider/request.js"

const BASE = "https://app.tryspecter.com/api/v1"
const KEY = "invented-team-key-0001"

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } })

/** A fetch scripted per call, which records every request. */
function scripted(answers: (() => Response | Promise<Response>)[]) {
  const seen: { url: string; init: RequestInit }[] = []
  const fetch: Fetch = async (url, init) => {
    seen.push({ url, init })
    const next = answers.shift()
    if (next === undefined) throw new Error("the fetch ran out of answers")
    return next()
  }
  return { fetch, seen }
}

const input = (over: Partial<RestInput> = {}): RestInput => ({ method: "GET", path: "/searches", retry: "free", ...over })
const deps = (fetch: Fetch, over: Record<string, unknown> = {}) => ({ key: KEY, fetch, timeoutMs: 30_000, sleep: async () => {}, random: () => 0, ...over })

describe("the REST target", () => {
  test("accepts a relative path and its query, and sends the key only under the base", () => {
    const target = restTarget({ path: "/searches/companies/5432/results", query: { page: 0, limit: 25 } })
    expect(target.url.href).toBe(`${BASE}/searches/companies/5432/results?page=0&limit=25`)
    expect(onRestBase(target.url)).toBe(true)
    expect(onRestBase(new URL("https://elsewhere.example/api/v1/searches"))).toBe(false)
    expect(onRestBase(new URL("http://app.tryspecter.com/api/v1/searches"))).toBe(false)
  })

  test("refuses anything that could leave the base", () => {
    for (const path of ["//elsewhere/x", "/a/../b", "/a/%2e%2e/b", "searches", "/a b", "/a?x=1", "/a%zz"]) {
      expect(() => restTarget({ path }), path).toThrow(ProviderError)
    }
  })
})

describe("one request", () => {
  test("sends the team key only in X-API-Key, and only to the REST origin", async () => {
    const { fetch, seen } = scripted([() => json({ ok: true })])
    const answer = await request(input(), deps(fetch))
    expect(answer.ok).toBe(true)
    expect(seen[0]!.init.headers).toMatchObject({ "X-API-Key": KEY, Accept: "application/json" })
  })

  test("a free read retries 5xx and 429; a credit-spending read never retries", async () => {
    const free = scripted([
      () => json({ errorCode: "UPSTREAM" }, 503),
      () => json({ errorCode: "RATE_LIMITED" }, 429, { "x-ratelimit-reset": "0" }),
      () => json({ ok: true }),
    ])
    const answer = await request(input(), deps(free.fetch))
    expect(answer.ok).toBe(true)
    expect(answer.attempts).toBe(3)

    const metered = scripted([() => json({ errorCode: "UPSTREAM" }, 503)])
    const once = await request(input({ retry: "never", path: "/companies/hedgehog-co" }), deps(metered.fetch))
    expect(once.ok).toBe(false)
    expect(once.attempts).toBe(1)
    expect(metered.seen).toHaveLength(1)
  })

  test("a free read retries a network failure, and reports the last one", async () => {
    let calls = 0
    const fetch: Fetch = async () => {
      calls++
      throw new TypeError("fetch failed")
    }
    await expect(request(input(), deps(fetch))).rejects.toThrow(/UNAVAILABLE: Could not reach app.tryspecter.com/)
    expect(calls).toBe(3)
  })

  test("a GET follows a redirect within the base; a POST never follows one", async () => {
    const get = scripted([() => json({}, 302, { location: "/api/v1/searches?page=2" }), () => json({ ok: true })])
    const answer = await request(input(), deps(get.fetch))
    expect(answer.ok).toBe(true)
    expect(get.seen.map((one) => one.url)).toEqual([`${BASE}/searches`, `${BASE}/searches?page=2`])

    const post = scripted([() => json({}, 302, { location: "/api/v1/elsewhere" })])
    await expect(request(input({ method: "POST", path: "/companies/resolve" }), deps(post.fetch))).rejects.toThrow(/a change never follows one/)

    const offHost = scripted([() => json({}, 302, { location: "https://elsewhere.example/api/v1/searches" })])
    await expect(request(input(), deps(offHost.fetch))).rejects.toThrow(/outside its REST API/)
  })

  test("a body over the inline cap is cut and marked truncated; the key is never echoed back", async () => {
    const companies = Array.from({ length: 200 }, (_, index) => ({ id: `company-${index}`, name: `Company ${index}`, note: KEY }))
    const { fetch } = scripted([() => json(companies)])
    const answer = await request(input({ path: "/searches/companies/1/results", maxInlineBytes: 500 }), deps(fetch))
    expect(answer.truncated).toBe(true)
    expect(JSON.stringify(answer.data)).not.toContain(KEY)
  })

  test("a response cut while reading is truncated", async () => {
    const body = JSON.stringify({ text: "x".repeat(200_000) })
    const { fetch } = scripted([() => new Response(body, { headers: { "content-type": "application/json" } })])
    const answer = await request(input(), deps(fetch))
    expect(answer.truncated).toBe(true)
  })

  test("the retry wait is Specter's, or backoff, and never above the cap", () => {
    expect(retryWait({ status: 429, headers: new Headers({ "x-ratelimit-reset": "2" }) }, 1)).toBe(2000)
    expect(backoff(1, "3", () => 0)).toBe(3000)
    expect(backoff(1, "9999", () => 0)).toBeUndefined()
    expect(jitter(1, () => 0.5)).toBe(500)
    expect(jitter(10, () => 1)).toBe(30_000)
  })
})
