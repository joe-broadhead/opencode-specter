import { describe, expect, test } from "vitest"
import { ProviderError } from "../../src/provider/errors.js"
import { MAX_CURSOR_LENGTH } from "@we-the-rebel-alliance/plugin-contract/cursor"
import type { RestInput } from "../../src/provider/request.js"
import { type Read, cursorAt, hashOf, listEvents, maxCursorLength } from "../../src/provider/saved.js"
import { FIXED_NOW, SAVED, SEARCHES, answer, savedRead } from "./helpers.js"

const owner = { id: "specter:key:0123456789abcdef", label: "Specter team key 01234567" }
const open = (read: Read) => async () => ({ read, owner })

/** A read whose page `page` holds `limit` companies, as Specter's paging does. */
function paged(companies: readonly unknown[], onRead?: (path: string) => void): Read {
  return async (input) => {
    onRead?.(input.path)
    const page = typeof input.query?.["page"] === "number" ? input.query["page"] : 0
    const limit = typeof input.query?.["limit"] === "number" ? input.query["limit"] : 25
    const slice = companies.slice(page * limit, page * limit + limit)
    return answer(slice, slice.length)
  }
}

const firstInput = { source: "saved", scope: { search: SEARCHES.work }, since: "2026-11-19T09:00:00Z", limit: 100 }

describe("the saved-search feed", () => {
  test("answers a page of contract events, with a cost and a cursor bound to the account", async () => {
    const page = await listEvents(firstInput, { open: open(savedRead()), now: FIXED_NOW, account: "work" })
    expect(page.account).toBe("work")
    expect(page.source).toBe("saved")
    expect(page.owner).toEqual(owner)
    expect(page.events.map((event) => event.external_id)).toEqual(["company:hedgehog-co", "company:otter-co"])
    expect(page.events[0]).toMatchObject({ kind: "x-specter/company", occurred_at: "2026-11-20T09:00:00.000Z", title: "Hedgehog Labs", text: "", url: null, account: "work" })
    expect(page.cost).toEqual({ units: [{ per: "company", count: 2 }] })
    expect(page.more).toBe(false)
    expect(page.trust).toBe("untrusted")
    expect(page.plugin).toBe("@we-the-rebel-alliance/specter-plugin")
    expect(page.scope).toEqual({ search: SEARCHES.work })
    expect(page.cursor).toEqual(expect.any(String))
  })

  test("a cursor belongs to its account and search", async () => {
    const work = await listEvents(firstInput, { open: open(savedRead()), now: FIXED_NOW, account: "work" })
    await expect(listEvents({ ...firstInput, cursor: work.cursor, since: undefined }, { open: open(savedRead()), now: FIXED_NOW, account: "personal" })).rejects.toMatchObject({
      code: "CURSOR_INVALID",
    })
    await expect(listEvents({ ...firstInput, cursor: work.cursor, since: undefined }, { open: open(savedRead()), now: FIXED_NOW, account: "work" })).resolves.toMatchObject({ account: "work" })
  })

  test("pages by the caller's limit without listing a company twice", async () => {
    const read = paged(SAVED[SEARCHES.work])
    const first = await listEvents({ ...firstInput, limit: 1 }, { open: open(read), now: FIXED_NOW, account: "work" })
    expect(first.events.map((event) => event.external_id)).toEqual(["company:hedgehog-co"])
    expect(first.more).toBe(true)
    expect(first.cost).toEqual({ units: [{ per: "company", count: 1 }] })
    const second = await listEvents({ ...firstInput, limit: 1, cursor: first.cursor, since: undefined }, { open: open(read), now: FIXED_NOW, account: "work" })
    expect(second.events.map((event) => event.external_id)).toEqual(["company:otter-co"])
    expect(second.more).toBe(true)
    expect(second.cost).toEqual({ units: [{ per: "company", count: 2 }] })
    const third = await listEvents({ ...firstInput, cursor: second.cursor, since: undefined }, { open: open(read), now: FIXED_NOW, account: "work" })
    expect(third.events).toEqual([])
    expect(third.more).toBe(false)
    // The poll still reads the overlap, so it can cost credits without listing anything.
    expect(third.cost).toEqual({ units: [{ per: "company", count: 2 }] })
  })

  test("a since filter is carried in the cursor, never replaced by the default window", async () => {
    const calls: RestInput[] = []
    const read = savedRead((input) => calls.push(input))
    const since = "2026-11-19T09:00:00Z"
    const first = await listEvents({ source: "saved", scope: { search: SEARCHES.work }, since, limit: 1 }, { open: open(read), now: FIXED_NOW, account: "work" })
    const second = await listEvents({ source: "saved", scope: { search: SEARCHES.work }, cursor: first.cursor, limit: 1 }, { open: open(read), now: FIXED_NOW, account: "work" })
    const third = await listEvents({ source: "saved", scope: { search: SEARCHES.work }, cursor: second.cursor, limit: 1 }, { open: open(read), now: FIXED_NOW, account: "work" })
    expect(first.events.map((event) => event.external_id)).toEqual(["company:hedgehog-co"])
    expect(second.events.map((event) => event.external_id)).toEqual(["company:otter-co"])
    expect(third.events).toEqual([])
    // Every vendor read names the first call's since, not a fresh 24-hour default: the filter lives in the cursor.
    expect(calls.length).toBeGreaterThanOrEqual(2)
    expect(calls.map((call) => call.query?.["new_results_after"]).every((cutoff) => cutoff === "2026-11-19T09:00:00.000Z")).toBe(true)
  })

  test("a watermark older than Specter's 60 days answers one gap, without a read", async () => {
    let reads = 0
    const old = cursorAt("work", SEARCHES.work, "2026-01-01T00:00:00.000Z")
    const page = await listEvents({ ...firstInput, cursor: old, since: undefined }, { open: open(paged(SAVED[SEARCHES.work], () => reads++)), now: FIXED_NOW, account: "work" })
    expect(reads).toBe(0)
    expect(page.events).toEqual([])
    expect(page.more).toBe(true)
    expect(page.gap).toEqual({ reason: "expired", since: "2026-01-01T00:00:00.000Z" })
    // The page it answers carries a fresh watermark: reading on lists what Specter still holds, and no second gap.
    const next = await listEvents({ ...firstInput, cursor: page.cursor, since: undefined }, { open: open(paged(SAVED[SEARCHES.work])), now: FIXED_NOW, account: "work" })
    expect(next.gap).toBeUndefined()
    expect(next.events.map((event) => event.external_id)).toEqual(["company:hedgehog-co", "company:otter-co"])
  })

  test("a cursor that is not this source's is CURSOR_INVALID, never a silent restart", async () => {
    await expect(listEvents({ ...firstInput, cursor: "not-a-cursor", since: undefined }, { open: open(savedRead()), now: FIXED_NOW, account: "work" })).rejects.toMatchObject({ code: "CURSOR_INVALID" })
  })

  test("a source the plugin does not have is SOURCE_UNKNOWN, and a missing search is INPUT_INVALID", async () => {
    await expect(listEvents({ ...firstInput, source: "gmail" }, { open: open(savedRead()), now: FIXED_NOW, account: "work" })).rejects.toMatchObject({ code: "SOURCE_UNKNOWN" })
    await expect(listEvents({ source: "saved", scope: {} }, { open: open(savedRead()), now: FIXED_NOW, account: "work" })).rejects.toMatchObject({ code: "INPUT_INVALID" })
  })

  test("a provider failure is the contract's refusal", async () => {
    const read: Read = async () => ({ ok: false, status: 401, truncated: false, error: { errorCode: "API_KEY_NOT_VALID" }, attempts: 1, trust: { specterContent: "untrusted" } })
    await expect(listEvents(firstInput, { open: open(read), now: FIXED_NOW, account: "work" })).rejects.toMatchObject({ code: "NEEDS_SIGN_IN" })
  })

  test("a cut answer fails the page rather than listing part of it", async () => {
    const read: Read = async () => ({ ...answer(SAVED[SEARCHES.work], 2), truncated: true })
    await expect(listEvents(firstInput, { open: open(read), now: FIXED_NOW, account: "work" })).rejects.toMatchObject({ code: "UNAVAILABLE" })
  })

  test("the cursor stays inside the contract's 1,024 characters", () => {
    expect(maxCursorLength("work", SEARCHES.work)).toBeLessThanOrEqual(MAX_CURSOR_LENGTH)
    expect(maxCursorLength("personal", "99999999999999999999")).toBeLessThanOrEqual(MAX_CURSOR_LENGTH)
  })

  test("a company id's hash is 40 bits of its SHA-256, never the id", () => {
    expect(hashOf("hedgehog-co")).toMatch(/^[0-9a-f]{10}$/)
    expect(hashOf("hedgehog-co")).not.toContain("hedgehog")
    expect(hashOf("hedgehog-co")).toBe(hashOf("hedgehog-co"))
    expect(hashOf("hedgehog-co")).not.toBe(hashOf("otter-co"))
  })

  test("a refusal keeps the contract's one sentence", () => {
    expect(new ProviderError({ code: "CURSOR_INVALID", what: "The cursor is foreign", next: "Read again." }).message).toBe("CURSOR_INVALID: The cursor is foreign. Next step: Read again.")
  })
})
