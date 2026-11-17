// The REST client on a fake transport: no request leaves the process. No Specter endpoint is named: the paths are
// invented, because the tools that call real endpoints arrive in Slice 7.
import { describe, expect, it } from "vitest"
import { API_KEY_HEADER, REST_BASE } from "../../src/constants.js"
import { backoff, jitter, MAX_ATTEMPTS, MAX_DELAY_MS, MAX_INLINE_BYTES, request, type RequestDeps, restTarget, type RestInput, retryWait, upstreamError } from "../../src/api/request.js"
import { DUMMY_KEY } from "./fake.js"

type Sent = { url: string; method: string; headers: Record<string, string> }

function transport(answers: (Response | Error)[]) {
  const sent: Sent[] = []
  const fetch = async (url: string, init: RequestInit) => {
    sent.push({ url, method: String(init.method), headers: { ...(init.headers as Record<string, string>) } })
    const next = answers.shift() ?? new Response(null, { status: 599 })
    if (next instanceof Error) throw next
    return next
  }
  const waits: number[] = []
  const deps: RequestDeps = { key: DUMMY_KEY, fetch, timeoutMs: 5_000, sleep: async (ms) => void waits.push(ms), random: () => 0.5 }
  return { sent, waits, deps }
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } })
const read: RestInput = { method: "GET", path: "/example", class: "read" }

describe("where the key goes", () => {
  it("only to the REST base, only in X-API-Key", async () => {
    const { sent, deps } = transport([json({ ok: true })])
    await request(read, deps)
    expect(sent[0]!.url).toBe(`${REST_BASE}/example`)
    expect(sent[0]!.headers[API_KEY_HEADER]).toBe(DUMMY_KEY)
    expect(Object.entries(sent[0]!.headers).filter(([, value]) => value.includes(DUMMY_KEY)).map(([name]) => name)).toEqual([API_KEY_HEADER])
  })

  it("never follows a redirect to another origin, so the key never reaches it", async () => {
    const { sent, deps } = transport([new Response(null, { status: 302, headers: { location: "https://elsewhere.example.invalid/x" } })])
    await expect(request(read, deps)).rejects.toThrow(/^API_REDIRECT_OFF_HOST: /)
    expect(sent).toHaveLength(1)
  })

  it("follows a read's redirect within the REST base, with the key", async () => {
    const { sent, deps } = transport([new Response(null, { status: 301, headers: { location: `${REST_BASE}/moved` } }), json({ ok: true })])
    const output = await request(read, deps)
    expect(output.ok).toBe(true)
    expect(sent.map((item) => item.url)).toEqual([`${REST_BASE}/example`, `${REST_BASE}/moved`])
    expect(sent[1]!.headers[API_KEY_HEADER]).toBe(DUMMY_KEY)
  })

  it("never follows a redirect for a change, and refuses plain HTTP", async () => {
    const change = transport([new Response(null, { status: 307, headers: { location: `${REST_BASE}/moved` } })])
    await expect(request({ method: "POST", path: "/example", body: {}, class: "write" }, change.deps)).rejects.toThrow(/^API_REDIRECTED: /)
    const insecure = transport([new Response(null, { status: 302, headers: { location: "http://app.tryspecter.com/api/v1/x" } })])
    await expect(request(read, insecure.deps)).rejects.toThrow(/^API_REDIRECT_INSECURE: /)
  })

  it("refuses a path that could leave the base", () => {
    for (const path of ["https://elsewhere.example.invalid/", "//elsewhere.example.invalid", "/a/../b", "/a/%2e%2e/b", "/a?b=c", "/a\\b", "/%61"]) {
      expect(() => restTarget({ path }), path).toThrow(/^API_PATH_INVALID: /)
    }
  })
})

describe("retries (D6)", () => {
  it("wait for X-RateLimit-Reset on a 429, as Specter's docs say, before Retry-After", async () => {
    const { sent, waits, deps } = transport([json({ errorCode: "RATE_LIMITED", message: "You have been rate-limited" }, 429, { "x-ratelimit-reset": "0.4", "retry-after": "9" }), json({ ok: true })])
    expect(await request(read, deps)).toMatchObject({ ok: true, attempts: 2 })
    expect(sent).toHaveLength(2)
    expect(waits).toEqual([400])
    const headers = (values: Record<string, string>) => new Headers(values)
    expect(retryWait({ status: 429, headers: headers({ "x-ratelimit-reset": "1" }) }, 1)).toBe(1_000)
    expect(retryWait({ status: 429, headers: headers({ "x-ratelimit-reset": String(MAX_DELAY_MS / 1000 + 1) }) }, 1)).toBeUndefined()
    // X-RateLimit-Reset counts only on a 429; a 503 names its wait in Retry-After.
    expect(retryWait({ status: 503, headers: headers({ "x-ratelimit-reset": "1", "retry-after": "3" }) }, 1)).toBe(3_000)
    expect(retryWait({ status: 500, headers: headers({}) }, 1, () => 1)).toBe(1_000)
  })

  it("never retry a 402, 400, 401, 403, 404 or 422, even on a free read", async () => {
    for (const status of [400, 401, 402, 403, 404, 422]) {
      const { sent, deps } = transport([json({ errorCode: "X" }, status), json({ ok: true })])
      expect((await request(read, deps)).status).toBe(status)
      expect(sent).toHaveLength(1)
    }
  })

  it("retry a free read on 429 and 5xx, honouring Retry-After", async () => {
    const { sent, waits, deps } = transport([json({}, 429, { "retry-after": "2" }), json({}, 503), json({ ok: true })])
    const output = await request(read, deps)
    expect(output).toMatchObject({ ok: true, attempts: 3 })
    expect(sent).toHaveLength(3)
    expect(waits[0]).toBe(2_000)
  })

  it("retry a free read after a network failure, with jittered backoff that never passes the cap", async () => {
    const { sent, waits, deps } = transport([new Error("socket hang up"), json({ ok: true })])
    expect(await request(read, deps)).toMatchObject({ ok: true, attempts: 2 })
    expect(sent).toHaveLength(2)
    expect(waits).toEqual([jitter(1, () => 0.5)])
    for (const attempt of [1, 2, 10, 40]) expect(jitter(attempt, () => 1)).toBeLessThanOrEqual(MAX_DELAY_MS)
  })

  it("never retry a spend call, whatever the failure", async () => {
    for (const answer of [json({}, 503), json({}, 429, { "retry-after": "1" }), new Error("socket hang up")]) {
      const { sent, deps } = transport([answer, json({ ok: true })])
      const result = await request({ method: "POST", path: "/example", body: {}, class: "spend" }, deps).catch((error: Error) => error)
      expect(sent).toHaveLength(1)
      if (!(result instanceof Error)) expect(result.attempts).toBe(1)
    }
  })

  it("say that a failed spend call was not retried and may have spent credits", async () => {
    const { deps } = transport([json({}, 502)])
    const output = await request({ method: "POST", path: "/example", body: {}, class: "spend" }, deps)
    expect(output.nextStep).toMatch(/not retried, because it may already have spent credits/)
  })

  it("never retry a write either", async () => {
    const { sent, deps } = transport([json({}, 503), json({ ok: true })])
    await request({ method: "POST", path: "/example", body: {}, class: "write" }, deps)
    expect(sent).toHaveLength(1)
  })

  it("stop after MAX_ATTEMPTS, and on a Retry-After above the cap", async () => {
    const many = transport(Array.from({ length: MAX_ATTEMPTS + 2 }, () => json({}, 500)))
    expect((await request(read, many.deps)).attempts).toBe(MAX_ATTEMPTS)
    const long = transport([json({}, 429, { "retry-after": String(MAX_DELAY_MS / 1000 + 1) }), json({ ok: true })])
    expect((await request(read, long.deps)).status).toBe(429)
    expect(backoff(1, String(MAX_DELAY_MS / 1000 + 1))).toBeUndefined()
  })
})

describe("failures", () => {
  it("map Specter's error object to the plugin's code, with its errorCode and request ID but never its message", async () => {
    const { deps } = transport([json({ errorCode: "OUT_OF_CREDITS", message: "secret-looking upstream words" }, 402, { "x-request-id": "550e8400-e29b-41d4-a716-446655440000", "x-creditlimit-limit": "1000", "x-creditlimit-remaining": "0", "x-creditlimit-reset": "3600" })])
    const output = await request(read, deps)
    expect(output).toMatchObject({
      ok: false,
      status: 402,
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      credits: { limit: 1000, remaining: 0, resetSeconds: 3600 },
      error: { code: "OUT_OF_CREDITS", errorCode: "OUT_OF_CREDITS" },
    })
    const error = upstreamError(output)
    expect(error.code).toBe("OUT_OF_CREDITS")
    expect(error.message).toMatch(/^OUT_OF_CREDITS: .*Specter request ID: 550e8400-e29b-41d4-a716-446655440000\. Next step: Wait for the period to renew, in 3600 seconds/)
    expect(error.message).not.toContain("secret-looking upstream words")
  })

  it("read the rate-limit headers as numbers", async () => {
    const { deps } = transport([json({ ok: true }, 200, { "x-ratelimit-limit": "15", "x-ratelimit-remaining": "14", "x-ratelimit-reset": "0.5" })])
    expect((await request(read, deps)).rateLimit).toEqual({ limit: 15, remaining: 14, resetSeconds: 0.5 })
  })
})

describe("results", () => {
  it("cap the inline result and say so", async () => {
    const { deps } = transport([json(Array.from({ length: 3_000 }, (_, index) => ({ index, text: "x".repeat(60) })))])
    const output = await request(read, deps)
    expect(Buffer.byteLength(JSON.stringify(output.data))).toBeLessThanOrEqual(MAX_INLINE_BYTES)
    expect(output).toMatchObject({ truncated: true, nextStep: expect.stringMatching(/Narrow the query/) })
  })

  it("report a timeout as API_TIMEOUT", async () => {
    const deps: RequestDeps = {
      key: DUMMY_KEY,
      timeoutMs: 10,
      fetch: (_url, init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
      sleep: async () => undefined,
    }
    await expect(request({ ...read, class: "write" }, deps)).rejects.toThrow(/^API_TIMEOUT: /)
  })
})
