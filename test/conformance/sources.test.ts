// The source contract's conformance kit (v0.2.0) over the one source `package.json` declares, run on the plugin's own
// `events_list`, `probe` and `scope.suggest` against recorded Specter answers (test/fixtures/sources.json, all invented):
// no Specter call, no key. Every read asserts its action and its provider operation on the kit's recording permission,
// exactly as the host and the tools RPC judge them, so the kit sees what a real read asserts.
//
// The report is written to reports/conformance-report.json for a release to attach. `failed[]` cannot occur (one GET
// answers a page, so no company can fail on its own), and it is declared as such; the 60-day window is real, so the
// expired-cursor check runs instead of being declared away.
import { describe, expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { type ConformanceReport, type PageCase, type SessionContext, declarationProblems, sourceConformance } from "@we-the-rebel-alliance/source-contract/conformance"
import { encodeBoundCursor } from "@we-the-rebel-alliance/source-contract/cursor"
import { readInstalledDescriptor } from "@we-the-rebel-alliance/source-contract/descriptor"
import { type Sources, SOURCES_SCHEMA } from "@we-the-rebel-alliance/source-contract/schema"
import { CREDIT_ESTIMATE_USD } from "../../src/costs.js"
import { ownSpecs } from "../../src/read-tools.js"
import { assertAction, fingerprintOf, type SourceCall, type SourceDeps, runEvents, runProbe } from "../../src/source/index.js"
import { ACCOUNT, RETENTION_DAYS, ownerOf } from "../../src/source/saved.js"
import { OWN_TOOL_CLASSES } from "../../src/tools.js"
import { TOOLS_RPC_ID } from "../../src/tools-rpc.js"
import { FIXTURE, provider } from "../support/specter-provider.js"

const root = fileURLToPath(new URL("../..", import.meta.url))
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string; version: string; sources: unknown }
/** The declaration as Memory's schema parses it, which is what the kit takes. */
const checked = SOURCES_SCHEMA.check(pkg.sources)
if (!checked.ok) throw new Error(`the sources declaration is invalid: ${checked.problems.join("; ")}`)
const sources: Sources = checked.value
const source = sources.items[0]!

const NOW = Date.parse(FIXTURE.now)
const SINCE = "2026-11-08T00:00:00.000Z"
const SEARCH = FIXTURE.search
const SCOPE = { search: SEARCH }
const KEY = "specter_team_key_for_tests"
const CALL: SourceCall = { sessionID: "ses_conformance", agent: "build", messageID: "msg_script", id: "script:conformance", signal: new AbortController().signal }
/** The plugin's tools, as a manifest declares them: every one a source names must be read-only. */
const TOOLS = Object.entries(OWN_TOOL_CLASSES).map(([id, toolClass]) => ({ id, readOnly: toolClass === "read" }))
/**
 * One GET answers a whole page, and the source fails the whole page rather than dropping an item: a body cut at the
 * inline cap, or a company record the plugin does not recognise, is UNAVAILABLE with the cursor held, so `failed[]`
 * (a retryable per-item drop) can never be produced.
 */
const ATOMIC = "every vendor read a page makes either succeeds whole or fails the page (UNAVAILABLE, cursor held), so no single company is ever dropped on its own"
/** `probe`'s and `events_list`'s own failures, as the plugin raises them. */
const deps = (context: SessionContext): SourceDeps => ({
  access: async () => ({ key: KEY, read: provider() }),
  permission: context.permission as never,
  now: () => NOW,
})
const list = (input: Record<string, unknown>, context: SessionContext) => runEvents(deps(context), input, CALL)
const probeCall = (input: Record<string, unknown>, context: SessionContext) => runProbe(deps(context), input, CALL)

/** The source's `scope.suggest`: the plugin's own free saved-search list, which asserts its action and its operation. */
function suggest(input: Record<string, unknown>, context: SessionContext) {
  const specs = ownSpecs({
    key: async () => KEY,
    fetch: async () => Response.json(FIXTURE.searches),
    timeoutMs: 5_000,
    assert: (call, action, resources) => assertAction(context.permission as never, action, call as never, resources),
  })
  return specs.find((spec) => spec.name === "list_saved_searches")!.run(input as never, CALL as never).then((outcome) => outcome.output)
}

/** A cursor this source issued, computed outside the kit so a case can name it. */
async function cursorFor(input: Record<string, unknown>): Promise<string> {
  const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => undefined } as never }
  return ((await list(input, open)) as { cursor: string }).cursor
}

const cases: PageCase[] = []
{
  const first = await cursorFor({ source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE })
  const done = await cursorFor({ source: "saved", account: ACCOUNT, scope: SCOPE, cursor: first })
  const stale = new Date(NOW - (RETENTION_DAYS + 1) * 86_400_000).toISOString()
  const elsewhere = encodeBoundCursor({ plugin: "specter", source: "saved", account: ACCOUNT, scope: { search: "9999" } }, { w: SINCE, p: 0, k: [] })
  cases.push(
    { name: "a first listing from since, one company refused for a secret in its name", input: { source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE }, expect: "page" },
    { name: "what came after the first listing: the inclusive boundary's repeat is dropped", input: { source: "saved", account: ACCOUNT, scope: SCOPE, cursor: first }, expect: "page" },
    { name: "the first listing two at a time, so the window pages", input: { source: "saved", account: ACCOUNT, scope: SCOPE, since: SINCE, limit: 2 }, expect: "page" },
    { name: "nothing new since the last listing", input: { source: "saved", account: ACCOUNT, scope: SCOPE, cursor: done }, expect: "empty" },
    { name: "a cursor whose watermark is older than Specter's 60-day window", input: { source: "saved", account: ACCOUNT, scope: SCOPE, cursor: encodeBoundCursor({ plugin: "specter", source: "saved", account: ACCOUNT, scope: SCOPE }, { w: stale, p: 0, k: [] }) }, expect: "expired" },
    { name: "a cursor for another saved search", input: { source: "saved", account: ACCOUNT, scope: SCOPE, cursor: elsewhere }, expect: { refuses: "CURSOR_INVALID" } },
    { name: "a read that names no saved search", input: { source: "saved", account: ACCOUNT }, expect: { refuses: "INPUT_INVALID" } },
    { name: "another source's name", input: { source: "companies", account: ACCOUNT, scope: SCOPE }, expect: { refuses: "SOURCE_UNKNOWN" } },
    { name: "another account", input: { source: "saved", account: "someone", scope: SCOPE }, expect: { refuses: "ACCOUNT_MISMATCH" } },
    { name: "a cursor bound to another plugin", input: { source: "saved", account: ACCOUNT, scope: SCOPE, cursor: encodeBoundCursor({ plugin: "y", source: "saved", account: ACCOUNT, scope: SCOPE }, { w: SINCE, p: 0, k: [] }) }, expect: { refuses: "CURSOR_INVALID" } },
  )
}

const reports: ConformanceReport[] = []

describe("the source contract's conformance kit", () => {
  test("the declaration validates, as a consumer reads it from the installed package", () => {
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    expect(installed.ok ? [] : installed.problems).toEqual([])
    expect(declarationProblems(pkg.sources, { tools: TOOLS })).toEqual([])
    expect(sources.rpc).toBe(TOOLS_RPC_ID)
    expect(sources.probe?.action).toBe("specter_probe")
    expect(sources.items.map((item) => item.id)).toEqual(["specter.saved"])
  })

  test(`specter.saved keeps the contract`, async () => {
    const report = await sourceConformance({
      plugin: pkg.name,
      source,
      tools: TOOLS,
      calls: { list, probe: probeCall, suggest },
      cases,
      account: ACCOUNT,
      sources: { rpc: TOOLS_RPC_ID, probe: { action: "specter_probe" } },
      describe: { id: TOOLS_RPC_ID },
      atomicPages: { reason: ATOMIC },
    })
    reports.push(report)
    expect(report.problems).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.incomplete).toBe(false)
    expect(report.identityOperations).toEqual([])
    expect(report.probeAction).toBe("specter_probe")
  })

  test("writes the report a release attaches", () => {
    const installed = readInstalledDescriptor(root, { version: pkg.version })
    const report = {
      contract: "@we-the-rebel-alliance/source-contract@0.2.0",
      plugin: pkg.name,
      version: pkg.version,
      descriptorHash: installed.ok ? installed.value.hash : null,
      ok: reports.every((entry) => entry.ok),
      sources: reports,
    }
    mkdirSync(join(root, "reports"), { recursive: true })
    writeFileSync(join(root, "reports", "conformance-report.json"), `${JSON.stringify(report, null, 2)}\n`)
    expect(report.ok).toBe(true)
  })

  test("the source is one account, one search key and no identity read", () => {
    expect(source).toMatchObject({
      id: "specter.saved",
      kind: "events",
      reads: "x-specter/company",
      tool: "events_list",
      accounts: { named: false },
      private: true,
      maxBytes: 65_536,
      scope: { keys: ["search"], suggest: { tool: "list_saved_searches", operations: ["searches.list"] } },
      permission: { events: "specter_events_list", operations: ["searches.companies.results"] },
      // Specter bills in credits from the team's plan and publishes no price per credit; v0.2.0 requires a metered
      // source to state a `usd` figure, so the declaration carries the plugin's estimate — rounded up from comparable
      // company-data APIs, and replaced by a team's contract rate. Never zero, and no `conditions` (v0.1.x refuses it).
      cost: { class: "metered", units: [{ per: "company", usd: CREDIT_ESTIMATE_USD }] },
    })
    // A consumer on v0.1.x refuses `permission.identity: []` ("expected array to have >=1 items"), so it is omitted:
    // v0.2.0 reads an absent `identity` as undeclared, and the probe asserts its action alone.
    expect(source.permission).not.toHaveProperty("identity")
  })


  test("the owner probe names is the key's organisation, never a person", async () => {
    const open: SessionContext = { account: ACCOUNT, permission: { assert: async () => undefined } as never }
    const result = await probeCall({ source: "saved" }, open)
    expect(result).toEqual({ source: "saved", account: ACCOUNT, owner: ownerOf(fingerprintOf(KEY)), trust: "untrusted" })
  })
})
