import { describe, expect, it } from "vitest"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { type SourceEvent, parseSourceError } from "@we-the-rebel-alliance/source-contract/events"
import type { EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import {
  ACCOUNT,
  MAX_CARRIED,
  MAX_PAGE,
  RETENTION_DAYS,
  type Read,
  type SourceAccess,
  listEvents,
  ownerOf,
  probe,
  searchesOf,
} from "../../src/source/saved.js"
import { FIXTURE, failure, provider } from "../support/specter-provider.js"

const NOW = Date.parse(FIXTURE.now)
const SINCE = "2026-11-08T00:00:00.000Z"
const SEARCH = FIXTURE.search
const SCOPE = { search: SEARCH }
const KEY = "specter_team_key_for_tests"

const access = (read: Read, owner = ownerOf("0123456789abcdef")) => async (): Promise<SourceAccess> => ({ read, owner })

/** One page from the provider, as the source answers it. */
const list = (input: Record<string, unknown>, read: Read, now = NOW) =>
  listEvents(input, { open: access(read), now }) as Promise<EventsListResult>

/** The code and next step of a refusal. */
async function refused(promise: Promise<unknown>): Promise<{ code?: string; next?: string; what: string }> {
  try {
    await promise
  } catch (error) {
    const parsed = parseSourceError(error)
    if (parsed === undefined) throw error
    return { code: parsed.code, ...(parsed.next === undefined ? {} : { next: parsed.next }), what: parsed.what }
  }
  throw new Error("it was not refused")
}

const ids = (page: EventsListResult) => page.events.map((event: SourceEvent) => event.external_id)

describe("specter.saved: a saved company search's net-new results", () => {
  it("lists the companies added since the read's start as events, oldest first, with the read's observation time", async () => {
    const read = provider()
    const page = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read)
    expect(page.source).toBe("saved")
    expect(page.account).toBe(ACCOUNT)
    expect(page.owner).toEqual(ownerOf("0123456789abcdef"))
    expect(page.scope).toEqual({ search: SEARCH })
    expect(page.plugin).toBe("@joe-broadhead/opencode-specter")
    expect(page.more).toBe(false)
    expect(page.trust).toBe("untrusted")
    expect(ids(page)).toEqual(["company:hedgehog", "company:otter", "company:pinecone", "company:quarry", "company:ridge", "company:quakeworks"])
    // Specter returns no "added at" time, so every event of a page carries the observation time of the read that first
    // listed it: the provider's Date header, which is Specter's clock.
    for (const event of page.events) expect(event.occurred_at).toBe(FIXTURE.now)
    expect(page.asOf).toBe(FIXTURE.now)
    // Metadata only: no prose, no link, and the company id and name.
    expect(page.events[0]).toMatchObject({ kind: "x-specter/company", title: "Hedgehog Analytics", text: "", url: null, thread: null, actors: [], labels: [] })
    // One credit per result Specter returned, the refused company included: it was returned, so it was charged.
    expect(page.cost).toEqual({ units: [{ per: "company", count: 7 }] })
    expect((read.calls[0]!.query ?? {})["new_results_after"]).toBe(SINCE)
    expect(read.calls[0]!.class).toBe("spend")
  })

  it("refuses a company whose name holds a secret, for good, and keeps it out of the page", async () => {
    const read = provider()
    const page = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read)
    expect(ids(page)).not.toContain("company:secretco")
    expect(page.refused).toEqual([{ external_id: "company:secretco", reason: "secret", detail: expect.stringContaining("api key") }])
  })

  it("carries the watermark, page and boundary ids in a cursor bound to the source, the account and the search", async () => {
    const read = provider()
    const page = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read)
    const cursor = page.cursor
    expect(cursor.length).toBeLessThanOrEqual(1024)
    const state = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>
    expect(state["s"]).toBe("saved")
    // Hashes, never ids: 16 hex characters each, whatever the ids' length.
    expect(state["k"]).toEqual(expect.any(Array))
    for (const hash of state["k"] as string[]) expect(hash).toMatch(/^[0-9a-f]{16}$/)
    // The window is done, so the watermark is the lookback line before its first observation, and the page is 0.
    expect(state["w"]).toBe(new Date(NOW - 120_000).toISOString())
    expect(state["p"]).toBe(0)
  })

  it("never repeats a company the inclusive cutoff lists again at the boundary", async () => {
    const read = provider()
    const first = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read)
    expect(ids(first)).toContain("company:quakeworks")
    // A company added at exactly the watermark is "on or after" it: Specter returns it again. The cursor's boundary
    // drops it instead of listing it twice.
    const second = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, cursor: first.cursor }, read)
    expect(ids(second)).toEqual([])
    expect(second.more).toBe(false)
    // It was dropped, but Specter still returned it: one credit, honestly reported.
    expect(second.cost).toEqual({ units: [{ per: "company", count: 1 }] })
  })

  it("drains a burst of companies added at one instant, a page at a time, without jamming or skipping one", async () => {
    const read = provider()
    const seen: string[] = []
    let cursor: string | undefined
    for (let call = 0; call < 10; call++) {
      const page = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, limit: 2, ...(cursor === undefined ? { since: SINCE } : { cursor }) }, read)
      seen.push(...ids(page))
      if (!page.more) break
      cursor = page.cursor
      expect(cursor).not.toBe(undefined)
    }
    expect(seen).toEqual(["company:hedgehog", "company:otter", "company:pinecone", "company:quarry", "company:ridge", "company:quakeworks"])
    // Every page of the burst read the same window: the watermark is fixed until the window is done, so the offset pages
    // address the same set.
    expect(new Set(read.calls.map((call) => (call.query ?? {})["new_results_after"]))).toEqual(new Set([SINCE]))
  })

  it("answers an older watermark as gap { reason: expired } once, and restarts after it without sliding", async () => {
    const read = provider()
    const stale = new Date(NOW - (RETENTION_DAYS + 1) * 86_400_000).toISOString()
    const cursor = encodeBoundCursor({ plugin: "specter", source: "saved", account: ACCOUNT, scope: SCOPE }, { w: stale, p: 0, k: [] })
    const page = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, cursor }, read)
    expect(page.gap).toEqual({ reason: "expired", since: stale })
    expect(page.events).toEqual([])
    expect(page.cost).toBeUndefined()
    // A gap asks the consumer to read on at once, from the earliest line Specter can still serve.
    expect(page.more).toBe(true)
    // The 60-day window is checked before any call, so a gap costs nothing.
    expect(read.calls).toEqual([])
    // The restart line is the window's edge, not "now": everything Specter still holds is listed rather than skipped.
    const restart = JSON.parse(Buffer.from(page.cursor, "base64url").toString("utf8")) as Record<string, unknown>
    expect(restart["w"]).toBe(new Date(NOW - RETENTION_DAYS * 86_400_000 + 3_600_000).toISOString())
    expect(restart).not.toHaveProperty("g")

    // The same expired cursor read again answers the same gap. Its restart is the window's edge for that read, which
    // is never "now": the sixty days Specter still holds are always re-read, at worst a minute of them twice.
    const again = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, cursor }, read, NOW + 600_000)
    expect(again.gap).toEqual({ reason: "expired", since: stale })
    expect(JSON.parse(Buffer.from(again.cursor, "base64url").toString("utf8"))["w"]).toBe(new Date(NOW + 600_000 - RETENTION_DAYS * 86_400_000 + 3_600_000).toISOString())

    // A company added a minute after the restart must be listed by the next read, however late the read happens: the
    // watermark comes from the cursor, never from "now".
    read.companies.push({ id: "novaworks", added: "2026-11-08T12:01:00.000Z", organization_name: "Nova Works" })
    read.advance(3_600_000)
    const next = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, cursor: page.cursor }, read, read.now())
    expect(ids(next)).toContain("company:novaworks")
    expect(next.gap).toBeUndefined()
    // The read that answered the gap set the window; a read an hour later still asks from that line, not from its own
    // clock, so nothing between them is skipped.
    expect((read.calls.at(-1)!.query ?? {})["new_results_after"]).toBe(new Date(NOW - RETENTION_DAYS * 86_400_000 + 3_600_000).toISOString())
  })

  it("answers Specter's own retention error as the same gap, never as an upstream failure", async () => {
    const read = provider()
    read.failNext(failure(422, "NEW_RESULTS_AFTER_BEYOND_RETENTION"))
    const page = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read)
    expect(page.gap).toEqual({ reason: "expired", since: SINCE })
    expect(page.events).toEqual([])
  })

  it("needs the search in the scope, and refuses another source, another account and a foreign cursor", async () => {
    const read = provider()
    expect((await refused(list({ source: "saved", account: ACCOUNT }, read))).code).toBe("INPUT_INVALID")
    expect((await refused(list({ source: "saved", account: ACCOUNT, scope: { search: "not-a-number" } }, read))).code).toBe("INPUT_INVALID")
    expect((await refused(list({ source: "other", account: ACCOUNT, scope: SCOPE }, read))).code).toBe("SOURCE_UNKNOWN")
    expect((await refused(list({ source: "saved", account: "someone", scope: SCOPE }, read))).code).toBe("ACCOUNT_MISMATCH")
    const foreign = encodeBoundCursor({ plugin: "y", source: "saved", account: ACCOUNT, scope: SCOPE }, { w: SINCE, p: 0, k: [] })
    expect((await refused(list({ source: "saved", account: ACCOUNT, scope: SCOPE, cursor: foreign }, read))).code).toBe("CURSOR_INVALID")
    const otherSearch = encodeBoundCursor({ plugin: "specter", source: "saved", account: ACCOUNT, scope: { search: "9999" } }, { w: SINCE, p: 0, k: [] })
    expect((await refused(list({ source: "saved", account: ACCOUNT, scope: SCOPE, cursor: otherSearch }, read))).code).toBe("CURSOR_INVALID")
  })

  it("maps Specter's failures to the contract's codes: sign-in, budget, rate limit, unknown search", async () => {
    const read = provider()
    read.failNext(failure(401, "API_KEY_NOT_VALID"))
    expect((await refused(list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read))).code).toBe("NEEDS_SIGN_IN")
    read.failNext(failure(402, "OUT_OF_CREDITS", { creditsReset: 900 }))
    const budget = await refused(list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read))
    expect(budget.code).toBe("RATE_LIMITED")
    read.failNext(failure(429, "RATE_LIMITED", { rateReset: 2 }))
    expect((await refused(list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read))).code).toBe("RATE_LIMITED")
    read.failNext(failure(404, "NOT_FOUND"))
    expect((await refused(list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read))).code).toBe("INPUT_INVALID")
    read.failNext(failure(400, "NOT_SUPPORTED_PRODUCT"))
    expect((await refused(list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read))).code).toBe("INPUT_INVALID")
  })

  it("refuses with NEEDS_SIGN_IN when no team key is connected", async () => {
    const result = await refused(listEvents({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, { open: async () => undefined as never, now: NOW }))
    expect(result.code).toBe("NEEDS_SIGN_IN")
    expect(result.next).toMatch(/^Run \/connect, choose Specter/)
  })

  it("pulls the local clock back when an answer carries no Date, so it can only ask for more", async () => {
    const read = provider()
    const first = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, read)
    // An answer with no Date header: the watermark is the plugin's clock minus CLOCK_MARGIN_MS, never the raw clock.
    const { observation, CLOCK_MARGIN_MS } = await import("../../src/source/saved.js")
    const bare = { ok: true, status: 200, truncated: false, attempts: 1, trust: { specterContent: "untrusted" } } as const
    expect(observation(bare, NOW)).toBe(new Date(NOW - CLOCK_MARGIN_MS).toISOString())
    expect(observation({ ...bare, serverTime: "Sun, 08 Nov 2026 11:59:00 GMT" }, NOW)).toBe("2026-11-08T11:59:00.000Z")
    expect(first.asOf).toBe(FIXTURE.now)
  })

  it("keeps a page inside its bounds: the limit, and at most MAX_PAGE companies", async () => {
    const read = provider()
    const page = await list({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE, limit: 500 }, read)
    expect(page.events.length).toBeLessThanOrEqual(MAX_PAGE)
    expect(Number((read.calls[0]!.query ?? {})["limit"])).toBe(MAX_PAGE)
    expect(MAX_CARRIED).toBe(MAX_PAGE + 5)
  })
})

describe("specter.saved: probe", () => {
  it("names the key's organisation from Specter's free credit balance, and nothing else", async () => {
    const read = provider()
    const result = await probe({ source: "saved" }, { open: access(read) })
    expect(result).toEqual({ source: "saved", account: ACCOUNT, owner: ownerOf("0123456789abcdef"), trust: "untrusted" })
    expect(result.owner.id).toMatch(/^specter:key:[0-9a-f]{16}$/)
    expect(read.calls.map((call) => `${call.method} ${call.path}`)).toEqual(["GET /organization/credits"])
    expect(read.calls[0]!.class).toBe("read")
  })

  it("names the organisation of a key whose credits are spent, and refuses one Specter rejects", async () => {
    const spent = provider()
    spent.failNext(failure(402, "OUT_OF_CREDITS"))
    expect((await probe({}, { open: access(spent) })).owner.id).toMatch(/^specter:key:/)
    const rejected = provider()
    rejected.failNext(failure(401, "API_KEY_NOT_VALID"))
    expect((await refused(probe({}, { open: access(rejected) }))).code).toBe("NEEDS_SIGN_IN")
  })

  it("refuses another source or account, and reads nothing when no key is connected", async () => {
    const read = provider()
    expect((await refused(probe({ source: "other" }, { open: access(read) }))).code).toBe("SOURCE_UNKNOWN")
    expect((await refused(probe({ account: "someone" }, { open: access(read) }))).code).toBe("ACCOUNT_MISMATCH")
    expect((await refused(probe({}, { open: async () => undefined as never }))).code).toBe("NEEDS_SIGN_IN")
    expect(read.calls).toEqual([])
  })
})

describe("specter.saved: the saved-search list", () => {
  it("reads the free list as saved searches, and keeps only what the plugin shows", () => {
    const searches = searchesOf(FIXTURE.searches)
    expect(searches.map((search) => [search.id, search.product_type])).toEqual([
      [5432, "company"],
      [5433, "people"],
    ])
    expect(searches[0]).toMatchObject({ name: "Europe series A", query_id: "q_company_1", new_count: 4, owner_id: "owner_1", is_global: false })
  })

  it("refuses a list that is not the array its reference documents", () => {
    expect(() => searchesOf({ unexpected: true })).toThrow(/^UNAVAILABLE: /)
  })
})

describe("specter.saved: the owner a key names", () => {
  it("is scheme-qualified, short, and never the key", () => {
    const owner = ownerOf("0123456789abcdef0123456789abcdef")
    expect(owner).toEqual({ id: "specter:key:0123456789abcdef", label: "Specter team key 01234567" })
    expect(JSON.stringify(owner)).not.toContain(KEY)
  })
})
