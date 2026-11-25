// Replays fixtures/conformance.json through the plugin's own handlers over the invented Specter: every page, the probe,
// the scope suggest and the status answer must match what was recorded, and the two-account behaviour must hold. The kit's
// `plugin-kit check` checks the same file's shape; this test proves the file is what the code answers.
import { describe, expect, test } from "vitest"
import { accountsOf, resolveAccount } from "@we-the-rebel-alliance/plugin-contract/accounts"
import { cursorAt } from "../../src/provider/saved.js"
import { manifest } from "../../src/manifest.js"
import { ACCOUNTS, inventedCall, inventedHandlers, recordedFixture } from "../support/specter.js"
import { SEARCHES } from "../unit/helpers.js"

interface Case {
  readonly name?: string
  readonly input?: Record<string, unknown>
  readonly expect?: string
  readonly refuses?: string
  readonly answer?: unknown
}

const fixture = recordedFixture() as {
  readonly accounts: { readonly aliases: readonly string[]; readonly required: { readonly method: string }; readonly unknown: { readonly account: string } }
  readonly sources: { readonly "specter.saved": { readonly cases: readonly Case[]; readonly probe: { readonly answer: unknown }; readonly suggest: { readonly answer: unknown } } }
  readonly events: { readonly status: unknown }
  readonly namespace: string
}

describe("the recorded conformance fixture", () => {
  test("is the installed package's own, and its namespace is the manifest's summary", () => {
    expect(fixture).toMatchObject({ plugin: "@we-the-rebel-alliance/specter-plugin" })
    expect(fixture.namespace).toBe(manifest.plugin.summary)
    expect(manifest.plugin.summary.length).toBeLessThanOrEqual(400)
  })

  test("every recorded page is what events_list answers, for its own account", async () => {
    const handlers = inventedHandlers()
    for (const item of fixture.sources["specter.saved"].cases) {
      const input = item.input ?? {}
      const call = inventedCall(typeof input["account"] === "string" ? input["account"] : "default")
      if (item.expect === "expired") {
        const answer = (await handlers["events_list"]!.run(input, call)) as { gap?: { reason: string }; more: boolean }
        expect(answer.gap, item.name).toEqual({ reason: "expired", since: "2026-01-01T00:00:00.000Z" })
        expect(answer.more).toBe(true)
      } else {
        await expect(handlers["events_list"]!.run(input, call), item.name).resolves.toEqual(item.answer)
      }
    }
  })

  test("a gap is answered once: the page its cursor names carries no gap", async () => {
    const handlers = inventedHandlers()
    const gap = (await handlers["events_list"]!.run({ source: "saved", scope: { search: SEARCHES.work }, cursor: cursorAt("work", SEARCHES.work, "2026-01-01T00:00:00.000Z") }, inventedCall("work"))) as { cursor: string }
    const next = (await handlers["events_list"]!.run({ source: "saved", scope: { search: SEARCHES.work }, cursor: gap.cursor }, inventedCall("work"))) as { gap?: unknown }
    expect(next.gap).toBeUndefined()
  })

  test("the probe and the scope suggest are what the handlers answer", async () => {
    const handlers = inventedHandlers()
    expect(await handlers["probe"]!.run({ source: "saved" }, inventedCall("work"))).toEqual(fixture.sources["specter.saved"].probe.answer)
    expect(await handlers["list_saved_searches"]!.run({}, inventedCall("work"))).toEqual(fixture.sources["specter.saved"].suggest.answer)
  })

  test("two aliases: a missing account is ACCOUNT_REQUIRED, an unknown one ACCOUNT_UNKNOWN, a cursor does not cross", async () => {
    const plan = accountsOf(manifest, { accounts: ACCOUNTS })
    expect(plan.ok).toBe(true)
    if (!plan.ok) return
    expect(plan.value.accounts.map((account) => account.alias)).toEqual([...fixture.accounts.aliases])
    expect(resolveAccount(plan.value.accounts, {})).toMatchObject({ ok: false, code: "ACCOUNT_REQUIRED" })
    expect(resolveAccount(plan.value.accounts, { account: fixture.accounts.unknown.account })).toMatchObject({ ok: false, code: "ACCOUNT_UNKNOWN" })

    const handlers = inventedHandlers()
    const work = (await handlers["events_list"]!.run({ source: "saved", scope: { search: SEARCHES.work }, since: "2026-11-19T09:00:00.000Z" }, inventedCall("work"))) as { cursor: string }
    await expect(handlers["events_list"]!.run({ source: "saved", scope: { search: SEARCHES.work }, cursor: work.cursor }, inventedCall("personal"))).rejects.toMatchObject({ code: "CURSOR_INVALID" })
  })

  test("the status answer is the handler's", async () => {
    const handlers = inventedHandlers()
    await expect(handlers["status"]!.run({}, inventedCall("work"))).resolves.toEqual(fixture.events.status)
  })
})
