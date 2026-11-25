// The invented Specter the fixture and the conformance tests replay: two synthetic accounts, one saved search each, and a
// fixed clock. Every company, search and id is invented; nothing leaves the machine.
import { readFileSync } from "node:fs"
import type { MethodCall } from "@we-the-rebel-alliance/plugin-contract/register"
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import { createHandlers } from "../../src/handlers/index.js"
import type { HandlerDeps } from "../../src/handlers/index.js"
import { manifest, version } from "../../src/manifest.js"
import { createProvider, type SpecterProvider } from "../../src/provider/specter.js"
import { COMPANIES, FIXED_NOW, INVENTED_KEY, SAVED, SEARCH_LIST } from "../unit/helpers.js"

/** The accounts every fixture and test uses: two synthetic aliases, no real people. */
export const ACCOUNTS = { work: {}, personal: {} }

const json = (data: unknown) => new Response(JSON.stringify(data), { headers: { "content-type": "application/json", date: "Fri, 20 Nov 2026 09:00:00 GMT" } })

/** A fetch that answers the four endpoints the plugin uses, from the invented data. */
export const inventedFetch = async (url: string, init: RequestInit) => {
  const parsed = new URL(url)
  const results = /^\/api\/v1\/searches\/companies\/([0-9]+)\/results$/.exec(parsed.pathname)
  if (results !== null) {
    const companies = SAVED[results[1] as keyof typeof SAVED] ?? []
    const page = Number(parsed.searchParams.get("page") ?? 0)
    const limit = Number(parsed.searchParams.get("limit") ?? 25)
    return json(companies.slice(page * limit, page * limit + limit))
  }
  if (parsed.pathname === "/api/v1/searches") return json(SEARCH_LIST)
  if (parsed.pathname === "/api/v1/organization/credits") return json({ credits_remaining: 100 })
  if (parsed.pathname === "/api/v1/companies/resolve") {
    return json([{ matches: [{ id: COMPANIES.hedgehog.id, name: COMPANIES.hedgehog.organization_name, domain: "hedgehog.example", hq: COMPANIES.hedgehog.hq, founded_year: 2019, match_confidence: 0.98 }] }])
  }
  throw new Error(`the invented Specter does not answer ${init.method} ${parsed.pathname}`)
}

/** The provider over the invented Specter, at the fixed clock. */
export function inventedProvider(): SpecterProvider {
  return createProvider({ key: async () => INVENTED_KEY, timeoutMs: 1000, fetch: inventedFetch as never, now: () => FIXED_NOW })
}

/** The handler table a fixture run uses, with both aliases needing a sign-in. */
export function inventedHandlers(over: Partial<HandlerDeps> = {}): HandlerTable {
  return createHandlers({
    manifest,
    version,
    options: { accounts: ACCOUNTS },
    hostVersion: "2.4.1",
    provider: inventedProvider(),
    servers: async () => [
      { name: "specter-work", state: "needs_auth" },
      { name: "specter-personal", state: "needs_auth" },
    ],
    problems: () => [],
    ...over,
  })
}

/** A call as the register hands a handler. */
export function inventedCall(account: string, unguardedAgents: readonly string[] = []): MethodCall {
  return {
    sessionID: "ses_fixture",
    agent: "build",
    messageID: "msg_fixture",
    id: "call_fixture",
    signal: new AbortController().signal,
    progress: async () => {},
    account,
    unguardedAgents: async () => ({ ok: true as const, agents: unguardedAgents }),
    door: "rpc",
  } as unknown as MethodCall
}

/** fixtures/conformance.json as committed. */
export function recordedFixture(): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL("../../fixtures/conformance.json", import.meta.url), "utf8")) as Record<string, unknown>
}
