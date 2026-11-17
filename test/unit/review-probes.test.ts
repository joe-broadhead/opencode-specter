// The independent review's falsification probes for #3 (plan/reviews/wave-B/specter-3.md, P1–P14), kept as permanent
// tests in their fixed form: each asserts the behaviour the review's Fix sections require. No network and no key: the
// recorded provider answers, and P13 goes through the real request layer with a stub fetch.
//
// P4 and P11 assert a refusal rather than a partial page: the fix is to fail the whole page closed, not to list the
// items around the one the plugin does not recognise.
import { describe, expect, it } from "vitest"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import type { EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import { request } from "../../src/api/request.js"
import { ACCOUNT, MAX_PAGE, RECORD_BUDGET_BYTES, type Read, RETENTION_DAYS, SOURCE_INLINE_BYTES, type SourceAccess, listEvents, maxCursorLength, ownerOf } from "../../src/source/saved.js"
import { FIXTURE, failure, provider } from "../support/specter-provider.js"

const NOW = Date.parse(FIXTURE.now)
const DAY = 86_400_000
const HOUR = 3_600_000
const SEARCH = FIXTURE.search
const SCOPE = { search: SEARCH }
const access = (read: Read) => async (): Promise<SourceAccess> => ({ read, owner: ownerOf("0123456789abcdef") })
const list = (input: Record<string, unknown>, read: Read, now: number) => listEvents(input, { open: access(read), now }) as Promise<EventsListResult>
const ids = (page: EventsListResult) => page.events.map((event) => event.external_id)
const bind = { plugin: "specter", source: "saved", account: ACCOUNT, scope: SCOPE }
const iso = (ms: number) => new Date(ms).toISOString()

/** Read to the end of the feed (more: false), collecting ids and gaps. */
async function drain(read: ReturnType<typeof provider>, start: Record<string, unknown>, now: () => number, max = 50) {
  const seen: string[] = []
  const gaps: unknown[] = []
  let input = start
  let last: EventsListResult | undefined
  for (let call = 0; call < max; call++) {
    last = await list({ scope: SCOPE, ...input }, read, now())
    seen.push(...ids(last))
    if (last.gap) gaps.push(last.gap)
    input = { cursor: last.cursor, ...(start["limit"] === undefined ? {} : { limit: start["limit"] }) }
    if (!last.more) break
  }
  return { seen, gaps, cursor: last!.cursor }
}

describe("review probes", () => {
  it("P1 a gap restarts at the earliest readable line, so history Specter still holds is listed", async () => {
    const read = provider()
    // A company added 30 days ago: inside Specter's 60-day window, so still readable.
    read.companies.push({ id: "retained30", added: iso(NOW - 30 * DAY), organization_name: "Retained" })
    const cursor = encodeBoundCursor(bind, { w: iso(NOW - 61 * DAY), p: 0, k: [] })
    const r = await drain(read, { cursor }, () => NOW)
    expect(r.gaps).toEqual([{ reason: "expired", since: iso(NOW - 61 * DAY) }])
    expect(r.seen).toContain("company:retained30")
  })

  it("P2 Specter's own 422 restarts at the window's edge, so retained history is not skipped", async () => {
    const read = provider()
    read.companies.push({ id: "retained20", added: iso(NOW - 20 * DAY), organization_name: "Retained" })
    const w = iso(NOW - 60 * DAY + 60_000) // one minute inside the plugin's clock window
    const cursor = encodeBoundCursor(bind, { w, p: 0, k: [] })
    read.failNext(failure(422, "NEW_RESULTS_AFTER_BEYOND_RETENTION"))
    const r = await drain(read, { cursor }, () => NOW)
    expect(r.gaps).toEqual([{ reason: "expired", since: w }])
    expect(r.seen).toContain("company:retained20")
    // The 422 is not charged, and the restart read is the one that costs: it asks from the edge, not from now.
    expect((read.calls.at(-1)!.query ?? {})["new_results_after"]).toBe(iso(NOW - RETENTION_DAYS * DAY + HOUR))
  })

  it("P3 a very old cursor restarts at the window's edge, and a read two hours later does not gap again", async () => {
    const read = provider()
    const cursor = encodeBoundCursor(bind, { w: iso(NOW - 200 * DAY), p: 0, k: [] })
    const r = await drain(read, { cursor }, () => NOW)
    const r2 = await drain(read, { cursor: r.cursor }, () => NOW + 2 * HOUR)
    expect(r.gaps).toHaveLength(1)
    expect(r2.gaps).toEqual([])
  })

  it("P4 one unrecognised record fails the whole page: nothing is lost silently and the watermark holds", async () => {
    const read = provider()
    const t = iso(NOW - HOUR)
    // The burst's 26th company carries a numeric id: it sits on the second page of the read.
    for (let n = 0; n < 30; n++) read.companies.push({ id: n === 25 ? (12345 as never) : `burst${String(n).padStart(3, "0")}`, added: t, organization_name: `Burst ${n}` })
    const first = await list({ scope: SCOPE, since: iso(NOW - 2 * HOUR), limit: 25 }, read, NOW)
    // The second page holds the numeric id: the page is refused, and the cursor it was asked with still works once
    // Specter's answer is one the plugin recognises.
    await expect(list({ scope: SCOPE, cursor: first.cursor, limit: 25 }, read, NOW)).rejects.toThrow(/^UNAVAILABLE: /)
    read.companies[read.companies.findIndex((company) => (company.id as unknown) === 12345)] = { id: "burst025", added: t, organization_name: "Burst 25" }
    const rest = await drain(read, { cursor: first.cursor, limit: 25 }, () => NOW)
    for (const id of Array.from({ length: 30 }, (_, n) => `company:burst${String(n).padStart(3, "0")}`)) {
      expect([...ids(first), ...rest.seen]).toContain(id)
    }
  })

  it("P5 a company added at an offset already read is listed by the next window's lookback", async () => {
    const read = provider()
    const t = iso(NOW - HOUR)
    for (let n = 0; n < 30; n++) read.companies.push({ id: `win${String(n).padStart(3, "0")}`, added: t, organization_name: `W ${n}` })
    let clock = NOW
    const p1 = await list({ scope: SCOPE, since: iso(NOW - 2 * HOUR), limit: 25 }, read, clock)
    // Specter adds a company while the reader pages, and (order undocumented) it sorts first.
    read.advance(1000)
    clock += 1000
    read.companies.unshift({ id: "midwindow", added: iso(clock - 500), organization_name: "Mid" })
    read.advance(1000)
    clock += 1000
    const r = await drain(read, { cursor: p1.cursor, limit: 25 }, () => clock)
    const r2 = await drain(read, { cursor: r.cursor, limit: 25 }, () => clock)
    expect([...ids(p1), ...r.seen, ...r2.seen]).toContain("company:midwindow")
  })

  it("P6 a company leaving the search mid-window shifts the rest back: the page overlap recovers it", async () => {
    const read = provider()
    const t = iso(NOW - HOUR)
    for (let n = 0; n < 30; n++) read.companies.push({ id: `lv${String(n).padStart(3, "0")}`, added: t, organization_name: `L ${n}` })
    const p1 = await list({ scope: SCOPE, since: iso(NOW - 2 * HOUR), limit: 25 }, read, NOW)
    // A company on page 0 stops matching (filter edit, re-score).
    read.companies.splice(read.companies.findIndex((company) => company.id === "lv003"), 1)
    const r = await drain(read, { cursor: p1.cursor, limit: 25 }, () => NOW + 1000)
    const all = [...ids(p1), ...r.seen]
    for (const id of Array.from({ length: 30 }, (_, n) => `company:lv${String(n).padStart(3, "0")}`)) expect(all).toContain(id)
  })

  it("P7 jam: 60 companies at one instant, limits 1, 7 and 25, all drain with no repeat", async () => {
    for (const limit of [1, 7, 25]) {
      const read = provider()
      const t = iso(NOW - HOUR)
      for (let n = 0; n < 60; n++) read.companies.push({ id: `jam${String(n).padStart(3, "0")}`, added: t, organization_name: `J ${n}` })
      const r = await drain(read, { since: iso(NOW - 2 * HOUR), limit }, () => NOW, 400)
      const jam = r.seen.filter((id) => id.startsWith("company:jam"))
      expect(new Set(jam).size, `limit ${limit}`).toBe(60)
      expect(jam.length, `limit ${limit}`).toBe(60)
    }
  })

  it("P8 a gap is answered once per read, across small pages", async () => {
    const read = provider()
    const cursor = encodeBoundCursor(bind, { w: iso(NOW - 61 * DAY), p: 0, k: [] })
    const r = await drain(read, { cursor, limit: 1 }, () => NOW)
    const r2 = await drain(read, { cursor: r.cursor, limit: 1 }, () => NOW)
    expect(r.gaps.length + r2.gaps.length).toBe(1)
  })

  it("P9 a company visible only after the answer that carried a later Date is listed by the lookback", async () => {
    const read = provider()
    const first = await list({ scope: SCOPE, since: iso(NOW - DAY) }, read, NOW)
    // Specter commits a company stamped 200ms before the previous answer's Date, visible only now.
    read.companies.push({ id: "lateone", added: iso(NOW - 200), organization_name: "Late" })
    read.advance(60_000)
    const r = await drain(read, { cursor: first.cursor }, () => NOW + 60_000)
    expect(r.seen).toContain("company:lateone")
  })

  it("P10 an unshaped 200 body (object, not array) fails closed and holds the cursor", async () => {
    const read = provider()
    const first = await list({ scope: SCOPE, since: iso(NOW - DAY) }, read, NOW)
    read.failNext({ ok: true, status: 200, data: { items: [] }, truncated: false, attempts: 1, serverTime: iso(NOW + 1000), trust: { specterContent: "untrusted" } } as never)
    await expect(list({ scope: SCOPE, cursor: first.cursor }, read, NOW + 1000)).rejects.toThrow(/^UNAVAILABLE: /)
  })

  it("P11 an array of unrecognised records fails the page instead of listing nothing and advancing", async () => {
    const read = provider()
    const first = await list({ scope: SCOPE, since: iso(NOW - DAY) }, read, NOW)
    read.failNext({ ok: true, status: 200, data: [{ id: 1 }, { id: 2 }, { id: 3 }], truncated: false, attempts: 1, serverTime: iso(NOW + 1000), trust: { specterContent: "untrusted" } } as never)
    await expect(list({ scope: SCOPE, cursor: first.cursor }, read, NOW + 1000)).rejects.toThrow(/^UNAVAILABLE: /)
    // The cursor is unchanged by the failed read, so the window can be read again: its watermark is the lookback line
    // the first page set, not one the failure moved.
    expect(JSON.parse(Buffer.from(first.cursor, "base64url").toString("utf8"))["w"]).toBe(iso(NOW - 120_000))
  })

  it("P12 a truncated (capped) 200 body is not taken as a short page", async () => {
    const read = provider()
    const first = await list({ scope: SCOPE, since: iso(NOW - DAY) }, read, NOW)
    read.failNext({ ok: true, status: 200, data: [], truncated: true, attempts: 1, serverTime: iso(NOW + 1000), trust: { specterContent: "untrusted" } } as never)
    await expect(list({ scope: SCOPE, cursor: first.cursor }, read, NOW + 1000)).rejects.toThrow(/^UNAVAILABLE: /)
  })
})

describe("review probe P13: the real request layer, realistic record sizes", () => {
  it("P13 a page of ~5 KB company records is read whole, not cut into a short page", async () => {
    const all = Array.from({ length: 60 }, (_, n) => ({
      id: `big${String(n).padStart(3, "0")}`,
      organization_name: `Big ${n}`,
      technologies: Array.from({ length: 250 }, (_, k) => `Technology number ${k}`),
      website: { domain: `big${n}.example` },
      hq: { city: "X", country: "Y" },
      funding: {},
      web: {},
      reviews: {},
      socials: {},
      contact: {},
    }))
    expect(JSON.stringify(all[0]).length).toBeGreaterThan(4_000)
    let clock = NOW
    const fetchStub = (async (url: string | URL) => {
      const parsed = new URL(String(url))
      const page = Number(parsed.searchParams.get("page"))
      const limit = Number(parsed.searchParams.get("limit"))
      const after = Date.parse(parsed.searchParams.get("new_results_after") ?? "1970-01-01T00:00:00Z")
      const body = after > NOW - HOUR ? [] : all.slice(page * limit, page * limit + limit)
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", date: new Date(clock).toUTCString() } })
    }) as unknown as typeof fetch
    const read: Read = (input) => request(input, { key: "k_test", fetch: fetchStub, timeoutMs: 5_000, base: "https://app.tryspecter.com/api/v1" })
    const seen: string[] = []
    let charged = 0
    let input: Record<string, unknown> = { scope: SCOPE, since: iso(NOW - 2 * HOUR) }
    for (let call = 0; call < 20; call++) {
      const page = await listEvents(input, { open: access(read), now: clock })
      seen.push(...ids(page))
      charged += page.cost?.units[0]?.count ?? 0
      clock += 1000
      input = { scope: SCOPE, cursor: page.cursor }
      if (!page.more) break
    }
    expect(seen).toHaveLength(60)
    // One credit per company Specter returned, the page overlap included.
    expect(charged).toBeGreaterThanOrEqual(60)
  })
})

describe("review probe P14: the cursor with Specter-shaped ids, after a gap", () => {
  it("P14 a full page of 24-hex ids encodes, and the worst case stays inside the contract's 1,024", async () => {
    const read = provider()
    read.companies.splice(0, read.companies.length)
    const t = iso(NOW - HOUR)
    for (let n = 0; n < 30; n++) read.companies.push({ id: (n.toString(16).padStart(2, "0") + "e3bc2b700c8f4c966ad2bb").slice(0, 24), added: t, organization_name: `Hex ${n}` })
    const stale = encodeBoundCursor(bind, { w: iso(NOW - 200 * DAY), p: 0, k: [] })
    const gap = await list({ scope: SCOPE, cursor: stale }, read, NOW)
    expect(gap.gap?.reason).toBe("expired")
    expect(gap.more).toBe(true)
    // Three reads from the gap's cursor, at limit 25: every one answers a page with a cursor inside the limit.
    let cursor = gap.cursor
    const heights: number[] = []
    for (let attempt = 0; attempt < 3; attempt++) {
      const page = await list({ scope: SCOPE, cursor, limit: 25 }, read, NOW)
      heights.push(page.cursor.length)
      if (!page.more) break
      cursor = page.cursor
    }
    expect(heights.every((length) => length <= 1024)).toBe(true)
    expect(maxCursorLength(SEARCH)).toBeLessThanOrEqual(1024)
    // The worst case is fixed-width, and it is 922, not 1,055 — whatever the search's id.
    expect(maxCursorLength(SEARCH)).toBe(922)
    for (const id of ["1", "5432", "12345678901234567890"]) expect(maxCursorLength(id)).toBeLessThanOrEqual(1024)
    // And the page is sized so a page's own records stay inside the source's inline budget.
    expect(MAX_PAGE * RECORD_BUDGET_BYTES).toBeLessThanOrEqual(SOURCE_INLINE_BYTES)
  })
})
