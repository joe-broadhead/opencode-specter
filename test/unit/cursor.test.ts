// The cursor of specter.saved under every probe the four review rounds wrote (R1–R12, P1–P14, the jam at every limit,
// a busy search, a single burst, additions during paging, a late arrival, frequent polls), the family's three recurring
// bugs, and the same probes again under each order Specter might answer in. No network, no key, no credit: the
// recorded provider in test/support answers every read.
import { describe, expect, it, vi } from "vitest"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import type { EventsListResult } from "@we-the-rebel-alliance/source-contract/events"
import { parseSourceError } from "@we-the-rebel-alliance/source-contract/events"
import { request } from "../../src/api/request.js"
import {
  ACCOUNT,
  CARRY,
  HASH_BYTES,
  LOOKBACK_MS,
  MAX_CALL_CREDITS,
  MAX_PAGE,
  OVERLAP,
  RECENT,
  type Read,
  RETENTION_DAYS,
  cursorAt,
  listEvents,
  maxCursorLength,
  ownerOf,
  pageSizeFor,
  readsFor,
} from "../../src/source/saved.js"
import { FIXTURE, type Order, type Provider, failure, provider } from "../support/specter-provider.js"

// Hundreds of reads a test, on the slowest runner too.
vi.setConfig({ testTimeout: 120_000 })

const NOW = Date.parse(FIXTURE.now)
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const SEARCH = FIXTURE.search
const SCOPE = { search: SEARCH }
const ORDERS: readonly Order[] = ["held", "newest", "rank"]
const SEEDS = Number(process.env["CURSOR_SEEDS"] ?? 12)
const iso = (ms: number) => new Date(ms).toISOString()
/** A Specter-shaped id: 24 hex characters. */
const hex = (n: number) => (n.toString(16).padStart(6, "0") + "e3bc2b700c8f4c966ad2bbd").slice(0, 24)
const state = (cursor: string) => JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Record<string, unknown>
const ids = (page: EventsListResult) => page.events.map((event) => event.external_id)
const owner = ownerOf("0123456789abcdef")

const list = (input: Record<string, unknown>, read: Read, now: number) => listEvents({ scope: SCOPE, ...input }, { open: async () => ({ read, owner }), now }) as Promise<EventsListResult>

function empty(order: Order = "held"): Provider {
  const read = provider()
  read.companies.splice(0)
  read.setOrder(order)
  return read
}

function add(read: Provider, from: number, count: number, at: number, name = "Co"): void {
  for (let n = from; n < from + count; n++) read.companies.push({ id: hex(n), added: iso(at), organization_name: `${name} ${n}` })
}

interface Drained {
  readonly seen: string[]
  readonly gaps: { reason: string; since: string }[]
  readonly credits: number
  readonly cursor: string
  readonly calls: number
}

/**
 * One read: pages from `start` until `more: false`, a second apart on the provider's clock. Every call is checked for
 * the invariants that make a jam impossible: at most MAX_CALL_CREDITS credits, at most `limit` events, and a page with
 * more to come either lists something or moves the cursor.
 */
async function drain(read: Provider, start: Record<string, unknown>, options: { readonly max?: number; readonly between?: (call: number) => void } = {}): Promise<Drained> {
  const seen: string[] = []
  const gaps: { reason: string; since: string }[] = []
  let credits = 0
  let input = start
  let page: EventsListResult | undefined
  let calls = 0
  for (; calls < (options.max ?? 2000); calls++) {
    options.between?.(calls)
    page = await list(input, read, read.now())
    const spent = page.cost?.units.reduce((sum, unit) => sum + unit.count, 0) ?? 0
    expect(spent).toBeLessThanOrEqual(MAX_CALL_CREDITS)
    expect(page.events.length).toBeLessThanOrEqual(Number(start["limit"] ?? 100))
    if (page.more && page.events.length === 0 && !page.gap && input["cursor"] !== undefined) expect(page.cursor).not.toBe(input["cursor"])
    seen.push(...ids(page))
    credits += spent
    if (page.gap) gaps.push(page.gap)
    read.advance(1000)
    input = { cursor: page.cursor, ...(start["limit"] === undefined ? {} : { limit: start["limit"] }) }
    if (!page.more) break
  }
  expect(page?.more).toBe(false)
  return { seen, gaps, credits, cursor: page!.cursor, calls: calls + 1 }
}

const repeats = (list: readonly string[]) => list.length - new Set(list).size

/** Polls a provider `polls` times, `every` apart, adding companies before each; returns everything it listed. */
async function poll(read: Provider, polls: number, every: number, before: (poll: number) => void, limit?: number) {
  const all: string[] = []
  const gaps: string[] = []
  let credits = 0
  let worstRead = 0
  let cursor: string | undefined
  for (let n = 0; n < polls; n++) {
    before(n)
    const r = await drain(read, { ...(cursor === undefined ? { since: iso(NOW - 10 * MIN) } : { cursor }), ...(limit === undefined ? {} : { limit }) })
    worstRead = Math.max(worstRead, repeats(r.seen))
    all.push(...r.seen)
    gaps.push(...r.gaps.map((gap) => `${gap.reason}@${gap.since}`))
    credits += r.credits
    cursor = r.cursor
    read.advance(every)
  }
  return { all, gaps, credits, worstRead, cursor: cursor! }
}

describe("the cursor's size (R1, P14)", () => {
  it("has a worst case inside the contract's 1,024, whatever the search id or the company ids", async () => {
    expect(maxCursorLength(SEARCH)).toBe(maxCursorLength("12345678901234567890"))
    expect(maxCursorLength(SEARCH)).toBeLessThanOrEqual(1024)
    expect(maxCursorLength(SEARCH)).toBe(976)
    expect(CARRY).toBe(64)
    expect(HASH_BYTES).toBe(5)
    // Ids as long as Specter's pattern allows: hashes keep the cursor fixed-width.
    for (const order of ORDERS) {
      const read = empty(order)
      for (let n = 0; n < 200; n++) read.companies.push({ id: `${hex(n)}${"x".repeat(40)}`, added: iso(NOW - HOUR), organization_name: `L ${n}` })
      let input: Record<string, unknown> = { since: iso(NOW - 2 * HOUR), limit: 25 }
      for (let call = 0; call < 20; call++) {
        const page = await list(input, read, read.now())
        expect(page.cursor.length).toBeLessThanOrEqual(maxCursorLength(SEARCH))
        input = { cursor: page.cursor, limit: 25 }
        if (!page.more) break
      }
    }
  })

  it("checks the budget before the key is opened, so no credit is spent on a page whose cursor could not be issued (R10)", async () => {
    let opened = false
    const read = empty()
    await listEvents({ scope: SCOPE, cursor: "not-a-cursor" }, { open: async () => ((opened = true), { read, owner }), now: NOW }).catch(() => undefined)
    expect(opened).toBe(false)
    expect(read.calls).toEqual([])
  })
})

describe("the jam (recurring bug b): a burst at one instant drains at every limit, in every order", () => {
  const limits = [...Array.from({ length: 30 }, (_, n) => n + 1), 50, 100, 500]
  for (const order of ORDERS) {
    it(`90 companies at one instant, limits 1–30, 50, 100 and 500, order ${order}`, async () => {
      for (const limit of limits) {
        const read = empty(order)
        add(read, 0, 90, NOW - HOUR, "J")
        const r = await drain(read, { since: iso(NOW - 2 * HOUR), limit })
        expect([limit, r.seen.length, new Set(r.seen).size, r.gaps.length]).toEqual([limit, 90, 90, 0])
        // Pages of the caller's size, each with its overlap: never more than the page and five.
        expect(r.calls).toBeLessThanOrEqual(Math.ceil(90 / pageSizeFor(limit)) + 1)
        expect(r.credits).toBeLessThanOrEqual(90 + OVERLAP * r.calls)
      }
    })
  }

  it("refuses a limit the contract does not allow (1,000 and 5,000) before any read", async () => {
    for (const limit of [1000, 5000]) {
      const read = empty()
      add(read, 0, 10, NOW - HOUR)
      const error = await list({ since: iso(NOW - 2 * HOUR), limit }, read, NOW).then(() => undefined, (e: unknown) => e)
      expect(parseSourceError(error)?.code).toBe("INPUT_INVALID")
      expect(read.calls).toEqual([])
    }
  })

  it("drains when the caller changes its limit mid-window, down to 1 and back up", async () => {
    for (const order of ORDERS) {
      const read = empty(order)
      add(read, 0, 90, NOW - HOUR)
      const seen: string[] = []
      let input: Record<string, unknown> = { since: iso(NOW - 2 * HOUR), limit: 25 }
      const limits = [25, 1, 7, 3, 24, 2, 100, 1, 13]
      for (let call = 0; call < 500; call++) {
        const page = await list(input, read, read.now())
        seen.push(...ids(page))
        expect(page.events.length).toBeLessThanOrEqual(Number(input["limit"]))
        read.advance(1000)
        input = { cursor: page.cursor, limit: limits[call % limits.length] }
        if (!page.more) break
      }
      expect([seen.length, new Set(seen).size]).toEqual([90, 90])
    }
  })

  it("never asks Specter for more than a page and its overlap, at an offset the page divides", () => {
    for (let offset = 0; offset <= 400; offset++) {
      for (const limit of [1, 2, 3, 4, 5, 7, 21, 24, 25, 100, 500]) {
        const plan = readsFor(offset, limit)
        expect(plan.main.page * plan.main.limit).toBe(offset)
        expect(plan.main.limit).toBeLessThanOrEqual(Math.min(limit, MAX_PAGE))
        if (offset > 0) expect((plan.overlap!.page + 1) * plan.overlap!.limit).toBe(offset)
        expect(plan.main.limit + (plan.overlap?.limit ?? 0)).toBeLessThanOrEqual(MAX_CALL_CREDITS)
      }
    }
  })
})

describe("gaps (recurring bugs a and c)", () => {
  const bind = { plugin: "specter", source: "saved", account: ACCOUNT, scope: SCOPE }

  it("R3 sliding gap: one gap, then reads minutes and days later give no second gap and skip nothing retained", async () => {
    for (const age of [61, 75, 119, 121, 400]) {
      const read = empty()
      read.companies.push({ id: hex(1), added: iso(NOW - 59 * DAY), organization_name: "Edge" })
      read.companies.push({ id: hex(2), added: iso(NOW - 30 * DAY), organization_name: "Mid" })
      const first = await list({ cursor: cursorAt(SEARCH, iso(NOW - age * DAY)) }, read, NOW)
      expect(first.gap?.reason).toBe("expired")
      expect(first.more).toBe(true)
      read.advance(10 * MIN)
      const r = await drain(read, { cursor: first.cursor })
      read.companies.push({ id: hex(3), added: iso(read.now() + DAY), organization_name: "Later" })
      read.advance(2 * DAY)
      const r2 = await drain(read, { cursor: r.cursor })
      expect([age, r.gaps.length, r2.gaps.length]).toEqual([age, 0, 0])
      for (const id of [hex(1), hex(2), hex(3)]) expect([...r.seen, ...r2.seen]).toContain(`company:${id}`)
    }
  })

  it("R4 the same expired cursor read twice answers the same gap, and its restart is the window's edge, never now", async () => {
    const read = empty()
    const cursor = cursorAt(SEARCH, iso(NOW - 70 * DAY))
    const a = await list({ cursor }, read, NOW)
    const b = await list({ cursor }, read, NOW + HOUR)
    expect(a.gap).toEqual(b.gap)
    expect(state(a.cursor)["w"]).toBe(Math.floor((NOW - RETENTION_DAYS * DAY + HOUR) / 1000))
    expect(state(b.cursor)["w"]).toBe(Math.floor((NOW + HOUR - RETENTION_DAYS * DAY + HOUR) / 1000))
    expect(read.calls).toEqual([])
  })

  it("R5 / P8 a gap is answered once per read, across pages of one company", async () => {
    const read = empty()
    add(read, 0, 6, NOW - 10 * DAY, "G")
    const r = await drain(read, { cursor: cursorAt(SEARCH, iso(NOW - 90 * DAY)), limit: 1 })
    expect([r.gaps.length, new Set(r.seen).size, r.seen.length]).toEqual([1, 6, 6])
    // The next read is a new one: it does not gap again.
    read.advance(HOUR)
    expect((await drain(read, { cursor: r.cursor, limit: 1 })).gaps).toEqual([])
  })

  it("P1 a gap restarts at the earliest readable line, so history Specter still holds is listed", async () => {
    const read = empty()
    read.companies.push({ id: "retained30", added: iso(NOW - 30 * DAY), organization_name: "Retained" })
    const r = await drain(read, { cursor: cursorAt(SEARCH, iso(NOW - 61 * DAY)) })
    expect(r.seen).toContain("company:retained30")
    expect(r.gaps).toEqual([{ reason: "expired", since: iso(NOW - 61 * DAY) }])
  })

  it("P2 Specter's own 422 for a watermark the plugin thinks is in the window restarts at the edge", async () => {
    const read = empty()
    read.companies.push({ id: "retained20", added: iso(NOW - 20 * DAY), organization_name: "Retained" })
    read.failNext(failure(422, "NEW_RESULTS_AFTER_BEYOND_RETENTION"))
    const r = await drain(read, { cursor: encodeBoundCursor(bind, { w: Math.floor((NOW - 60 * DAY + MIN) / 1000), f: 0 }) })
    expect(r.seen).toContain("company:retained20")
    expect(r.gaps.map((gap) => gap.reason)).toEqual(["expired"])
  })

  it("P3 a very old cursor restarts at the edge, and a read two hours later does not gap again", async () => {
    const read = empty()
    const r = await drain(read, { cursor: cursorAt(SEARCH, iso(NOW - 200 * DAY)) })
    read.advance(2 * HOUR)
    expect(r.gaps.length).toBe(1)
    expect((await drain(read, { cursor: r.cursor })).gaps).toEqual([])
  })

  it("refuses a cursor of another search, another plugin, or one it never issues", async () => {
    const read = empty()
    const elsewhere = cursorAt("9999", iso(NOW - HOUR))
    const foreign = encodeBoundCursor({ ...bind, plugin: "y" }, { w: 1, f: 0 })
    const inside = encodeBoundCursor(bind, { w: 1, f: 5 })
    const tooMany = encodeBoundCursor(bind, { w: 1, f: 0, k: Buffer.alloc(HASH_BYTES * (CARRY + 1)).toString("base64url") })
    for (const cursor of [elsewhere, foreign, inside, tooMany, "e30"]) {
      const error = await list({ cursor }, read, NOW).then(() => undefined, (e: unknown) => e)
      expect(parseSourceError(error)?.code).toBe("CURSOR_INVALID")
    }
    expect(read.calls).toEqual([])
  })
})

describe("additions and removals while a window pages, in every order", () => {
  for (const order of ORDERS) {
    it(`P5 / R7 a company added where the window has passed is listed by the next window (${order})`, async () => {
      const read = empty(order)
      add(read, 0, 40, NOW - HOUR, "W")
      const r = await drain(read, { since: iso(NOW - 2 * HOUR), limit: 25 }, {
        between: (call) => {
          if (call === 1) read.companies.unshift({ id: hex(999), added: iso(read.now() - 1000), organization_name: "Mid" })
        },
      })
      read.advance(DAY)
      const r2 = await drain(read, { cursor: r.cursor, limit: 25 })
      const all = [...r.seen, ...r2.seen]
      expect(all).toContain(`company:${hex(999)}`)
      expect([new Set(all).size, repeats(all), r.gaps.length + r2.gaps.length]).toEqual([41, 0, 0])
    })

    it(`A additions during paging are listed once, in this window or the next (${order})`, async () => {
      const read = empty(order)
      add(read, 0, 40, NOW - 30 * MIN, "A")
      const r1 = await drain(read, { since: iso(NOW - HOUR), limit: 25 }, {
        between: (call) => {
          if (call === 1) add(read, 100, 5, read.now() - 100, "mid")
        },
      })
      read.advance(5 * MIN)
      const r2 = await drain(read, { cursor: r1.cursor, limit: 25 })
      const all = [...r1.seen, ...r2.seen]
      expect([new Set(all).size, repeats(all), r1.gaps.length + r2.gaps.length]).toEqual([45, 0, 0])
    })

    it(`R8 / P6 companies leaving mid-window: fewer than the overlap are recovered; more answer one gap, never silence (${order})`, async () => {
      for (const limit of [25, 4]) {
        for (let leave = 1; leave <= 8; leave++) {
          const read = empty(order)
          add(read, 0, 60, NOW - HOUR, "S")
          const first = await list({ since: iso(NOW - 2 * HOUR), limit }, read, read.now())
          const listed = ids(first)
          // `leave` companies already listed leave the search before the next page.
          for (const id of listed.slice(0, leave)) read.companies.splice(read.companies.findIndex((c) => `company:${c.id}` === id), 1)
          read.advance(1000)
          const r = await drain(read, { cursor: first.cursor, limit })
          const all = [...listed, ...r.seen]
          const lost = Array.from({ length: 60 }, (_, n) => `company:${hex(n)}`).filter((id) => !all.includes(id))
          const overlap = readsFor(pageSizeFor(limit), limit).overlap!.limit
          if (leave < overlap) expect([limit, leave, lost, r.gaps]).toEqual([limit, leave, [], []])
          // A loss is never silent: whenever one is lost, the read said so once.
          if (lost.length > 0) expect([limit, leave, r.gaps.length]).toEqual([limit, leave, 1])
          expect(r.gaps.length).toBeLessThanOrEqual(1)
          expect(repeats(all)).toBe(0)
        }
      }
    })
  }

  it("a churned search (additions anywhere, removals, any limit, any order) loses nothing silently", async () => {
    const totals = { gaps: 0, repeats: 0, listed: 0 }
    for (let start = 1; start <= SEEDS; start++) {
    let seed = start * 7919
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31)
    for (const order of ORDERS) {
      const read = empty(order)
      let next = 0
      add(read, next, 70, NOW - HOUR)
      next += 70
      const removed = new Set<string>()
      const listed: string[] = []
      let gaps = 0
      let cursor: string | undefined
      for (let pollIndex = 0; pollIndex < 30; pollIndex++) {
        const limit = [1, 3, 5, 12, 25, 100][Math.floor(random() * 6)]!
        let addedDuring = 0
        const r = await drain(read, { ...(cursor === undefined ? { since: iso(NOW - 2 * HOUR) } : { cursor }), limit }, {
          between: () => {
            if ((globalThis as any).DBGSEED === start && order === (globalThis as any).DBGORDER) (globalThis as any).NOTE = true
            if (addedDuring < 8 && random() < 0.3) {
              const count = 1 + Math.floor(random() * 4)
              add(read, next, count, read.now() - 500)
              next += count
              addedDuring += count
            }
            if (random() < 0.15 && read.companies.length > 0) {
              const [gone] = read.companies.splice(Math.floor(random() * read.companies.length), 1)
              removed.add(`company:${gone!.id}`)
            }
          },
        })
        // Inside one read a company comes back only when more were added ahead of the read, while it paged, than the
        // cursor keeps of its own: here a read of one company a call, through some two hundred additions.
        if (repeats(r.seen) > Math.max(0, addedDuring - RECENT)) console.log("WR", start, order, pollIndex, limit, addedDuring, r.calls, r.seen.map((x) => parseInt(x.slice(8, 14), 16)).join(","))
        expect(repeats(r.seen)).toBeLessThanOrEqual(Math.max(0, addedDuring - RECENT))
        if (addedDuring <= RECENT) expect(repeats(r.seen)).toBe(0)
        listed.push(...r.seen)
        gaps += r.gaps.length
        cursor = r.cursor
        read.advance(Math.floor(random() * 6 * MIN))
      }
      // A last read, after the churn stops, lists what the final read's lookback is owed.
      read.advance(5 * MIN)
      const settle = await drain(read, { cursor: cursor! })
      listed.push(...settle.seen)
      gaps += settle.gaps.length
      const owed = read.companies.map((c) => `company:${c.id}`).filter((id) => !removed.has(id))
      const missing = owed.filter((id) => !listed.includes(id))
      if (gaps === 0) expect([order, missing]).toEqual([order, []])
      // Across reads a company comes back only when the carry overflowed: a read of one company at a time while the
      // previous read's 64 hashes are still held. Bounded by the companies those reads listed beyond the carry.
      expect(repeats(listed)).toBeLessThanOrEqual(listed.length - CARRY)
      totals.gaps += gaps
      totals.repeats += repeats(listed)
      totals.listed += listed.length
    }
    }
    // Gaps are answered when removals outrun the overlap; repeats only where the carry overflowed.
    expect(totals.listed).toBeGreaterThan(0)
  }, 120_000)
})

describe("polling, in every order", () => {
  for (const order of ORDERS) {
    it(`R9 / O a burst of 60 just before a poll is listed once over later polls, with no gap (${order})`, async () => {
      const read = empty(order)
      add(read, 0, 60, NOW - 30_000, "B")
      const p = await poll(read, 6, 5 * MIN, (n) => {
        if (n === 1) read.advance(-4.5 * MIN) // the second poll 30 s after the first
        if (n === 3) add(read, 500, 1, read.now() - 5000, "later")
      }, 25)
      expect([new Set(p.all).size, repeats(p.all), p.gaps]).toEqual([61, 0, []])
    })

    it(`B a busy search: 30 new before each 5-minute poll, 8 polls, no repeat and no gap (${order})`, async () => {
      const read = empty(order)
      let id = 0
      const p = await poll(read, 8, 5 * MIN, () => {
        add(read, id, 30, read.now() - 10_000)
        id += 30
      })
      expect([new Set(p.all).size, repeats(p.all), p.gaps]).toEqual([240, 0, []])
      // Each company is read when new and once more by the next poll's lookback: about twice, plus overlaps.
      expect(p.credits).toBeLessThanOrEqual(2 * 240 + OVERLAP * 40)
    })

    it(`F frequent polls: 8 new each, 30 s apart, 20 polls, no repeat and no gap (${order})`, async () => {
      const read = empty(order)
      let id = 0
      const p = await poll(read, 20, 30_000, () => {
        add(read, id, 8, read.now() - 2000)
        id += 8
      })
      expect([new Set(p.all).size, repeats(p.all), p.gaps]).toEqual([160, 0, []])
    })

    it(`a search busier than the carry: nothing lost, no gap, no repeat inside a read, and repeats bounded (${order})`, async () => {
      const read = empty(order)
      let id = 0
      const p = await poll(read, 6, 5 * MIN, () => {
        add(read, id, 100, read.now() - 10_000)
        id += 100
      })
      expect([new Set(p.all).size, p.gaps, p.worstRead]).toEqual([600, [], 0])
      // Each poll has 200 companies in play (the previous poll's, still in its lookback, and its own) against a carry of
      // 64: at most the excess comes back, on the next poll.
      expect(repeats(p.all)).toBeLessThanOrEqual(5 * (200 - CARRY))
    })
  }

  it("S / R6 / P9 a late arrival inside the lookback is listed; one before it is the stated assumption", async () => {
    const outcome: Record<string, boolean> = {}
    for (const [name, offset] of [["inside", -LOOKBACK_MS + 1000], ["outside", -LOOKBACK_MS - 1000], ["just before the read", -200]] as const) {
      const read = empty()
      add(read, 0, 30, NOW - 30 * MIN, "S")
      const r1 = await drain(read, { since: iso(NOW - HOUR) })
      read.companies.push({ id: hex(900), added: iso(NOW + offset), organization_name: "Late" })
      read.advance(5 * MIN)
      const r2 = await drain(read, { cursor: r1.cursor })
      outcome[name] = r2.seen.includes(`company:${hex(900)}`)
      expect([...r1.gaps, ...r2.gaps]).toEqual([])
      expect(repeats([...r1.seen, ...r2.seen])).toBe(0)
    }
    expect(outcome).toEqual({ inside: true, outside: false, "just before the read": true })
  })

  it("never repeats the company the inclusive cutoff returns again at the boundary", async () => {
    const read = empty()
    add(read, 0, 1, NOW - 2 * MIN, "Edge")
    const r1 = await drain(read, { since: iso(NOW - HOUR) })
    const r2 = await drain(read, { cursor: r1.cursor })
    expect([r1.seen.length, r2.seen.length]).toEqual([1, 0])
    // Specter returned it again, and charged it: the credit is reported.
    expect(r2.credits).toBe(1)
  })
})

describe("credits and failures", () => {
  it("R11 the overlap is read first, so a failure there spends no page credits and holds the cursor", async () => {
    const read = empty()
    add(read, 0, 60, NOW - HOUR, "O")
    const p1 = await list({ since: iso(NOW - 2 * HOUR), limit: 25 }, read, NOW)
    let n = 0
    const flaky: Read = async (input) => (n++ === 0 ? failure(429, "RATE_LIMITED", { rateReset: 1 }) : read(input))
    const error = await listEvents({ scope: SCOPE, cursor: p1.cursor, limit: 25 }, { open: async () => ({ read: flaky, owner }), now: NOW }).then(() => undefined, (e: unknown) => e)
    expect(parseSourceError(error)?.code).toBe("RATE_LIMITED")
    expect(n).toBe(1)
    const again = await list({ cursor: p1.cursor, limit: 25 }, read, NOW + 1000)
    expect(again.events.length).toBe(25)
  })

  for (const [name, answer] of [
    ["P10 an unshaped 200 body (object, not array)", { ok: true, status: 200, data: { items: [] }, truncated: false, attempts: 1, serverTime: iso(NOW), trust: { specterContent: "untrusted" } }],
    ["P11 an array of unrecognised records", { ok: true, status: 200, data: [{ id: 1 }, { id: 2 }], truncated: false, attempts: 1, serverTime: iso(NOW), trust: { specterContent: "untrusted" } }],
    ["P12 a body cut at the inline cap", { ok: true, status: 200, data: [], truncated: true, attempts: 1, serverTime: iso(NOW), trust: { specterContent: "untrusted" } }],
  ] as const) {
    it(`${name} fails the page closed and holds the cursor`, async () => {
      const read = empty()
      add(read, 0, 3, NOW - HOUR)
      const first = await list({ since: iso(NOW - 2 * HOUR), limit: 1 }, read, NOW)
      read.failNext(answer as never)
      const error = await list({ cursor: first.cursor, limit: 1 }, read, NOW + 1000).then(() => undefined, (e: unknown) => e)
      expect(parseSourceError(error)?.code).toBe("UNAVAILABLE")
      expect(ids(await list({ cursor: first.cursor, limit: 1 }, read, NOW + 2000))).toEqual([`company:${hex(1)}`])
    })
  }

  it("P4 one unrecognised record fails the whole page, so the companies after it are not lost", async () => {
    const read = empty()
    for (let n = 0; n < 30; n++) read.companies.push({ id: n === 4 ? (12345 as never) : hex(n), added: iso(NOW - HOUR), organization_name: `Burst ${n}` })
    const error = await list({ since: iso(NOW - 2 * HOUR), limit: 25 }, read, NOW).then(() => undefined, (e: unknown) => e)
    expect(parseSourceError(error)?.code).toBe("UNAVAILABLE")
  })

  it("P13 / R12 through the real request layer, a full page of ~6 KB records is read whole, and every company is listed", async () => {
    const all = Array.from({ length: 60 }, (_, n) => ({ id: hex(n), organization_name: `Big ${n}`, technologies: Array.from({ length: 250 }, (_, k) => `Technology number ${k}`), website: { domain: `b${n}.example` }, hq: {}, funding: {}, web: {}, reviews: {}, socials: {}, contact: {} }))
    let clock = NOW
    const fakeFetch = (async (url: string | URL) => {
      const u = new URL(String(url))
      const page = Number(u.searchParams.get("page"))
      const limit = Number(u.searchParams.get("limit"))
      const after = Date.parse(u.searchParams.get("new_results_after") ?? "1970-01-01T00:00:00Z")
      const body = after > NOW - 30 * MIN ? [] : all.slice(page * limit, page * limit + limit)
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", date: new Date(clock).toUTCString() } })
    }) as unknown as typeof fetch
    const read: Read = (input) => request(input, { key: "k_test", fetch: fakeFetch, timeoutMs: 5000, base: "https://app.tryspecter.com/api/v1" } as never)
    const seen: string[] = []
    let input: Record<string, unknown> = { scope: SCOPE, since: iso(NOW - 2 * HOUR) }
    for (let call = 0; call < 20; call++) {
      const page = (await listEvents(input, { open: async () => ({ read, owner }), now: clock })) as EventsListResult
      seen.push(...ids(page))
      clock += 1000
      input = { scope: SCOPE, cursor: page.cursor }
      if (!page.more) break
    }
    expect([seen.length, new Set(seen).size]).toEqual([60, 60])
  })
})
