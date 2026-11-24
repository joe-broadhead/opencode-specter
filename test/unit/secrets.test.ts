// A known dummy key never appears in an error, a status, a log line or a result (SPEC.md §5).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { request, type RequestDeps, upstreamError } from "../../src/api/request.js"
import { keyReader } from "../../src/credential.js"
import { formatStatus, isStatus } from "../../src/rpc.js"
import { computeStatus } from "../../src/status.js"
import { DUMMY_KEY } from "./fake.js"

const logged: string[] = []
beforeEach(() => {
  logged.length = 0
  for (const level of ["log", "warn", "error", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logged.push(args.map(String).join(" ")))
  }
})
afterEach(() => vi.restoreAllMocks())

const expectClean = (value: unknown) => expect(typeof value === "string" ? value : JSON.stringify(value)).not.toContain(DUMMY_KEY)

function deps(fetch: RequestDeps["fetch"]): RequestDeps {
  return { key: DUMMY_KEY, fetch, timeoutMs: 5_000, sleep: async () => undefined }
}

/** An integration whose active connection resolves to the dummy key; `fail` makes the next read throw with it. */
function integration() {
  const state = { fail: false }
  const fake = {
    connection: {
      active: async () => ({ type: "credential", id: "con_1", label: "Team key" }),
      resolve: async () => {
        if (state.fail) throw new Error(`could not decrypt ${DUMMY_KEY}`)
        return { type: "key", key: DUMMY_KEY }
      },
    },
  }
  return { fake: fake as never, state }
}

describe("the team key", () => {
  it("is not in a result, even when Specter echoes it back", async () => {
    const echo = async () => new Response(JSON.stringify({ error: `invalid key ${DUMMY_KEY}` }), { status: 401, headers: { "content-type": "application/json" } })
    const output = await request({ method: "GET", path: "/example", class: "read" }, deps(echo))
    expectClean(output)
    expectClean(upstreamError(output).message)
  })

  it("is not in an error, even when the transport puts it in its message", async () => {
    const leaky = async () => {
      throw new Error(`connect failed with X-API-Key: ${DUMMY_KEY}`)
    }
    const error = await request({ method: "GET", path: "/example", class: "read" }, deps(leaky)).catch((caught: Error) => caught)
    expect(error).toBeInstanceOf(Error)
    expectClean((error as Error).message)
    const redirect = async () => new Response(null, { status: 302, headers: { location: `https://elsewhere.example.invalid/?k=${DUMMY_KEY}` } })
    expectClean(((await request({ method: "GET", path: "/example", class: "read" }, deps(redirect)).catch((caught: Error) => caught)) as Error).message)
  })

  it("is not in a log line when OpenCode fails to read it", async () => {
    const { fake, state } = integration()
    const read = keyReader(fake, (message) => console.warn(message))
    expect((await read())?.key).toBe(DUMMY_KEY)
    state.fail = true
    expect((await read())?.key).toBe(DUMMY_KEY)
    expect(logged.join("\n")).toMatch(/KEY_UNAVAILABLE/)
    expectClean(logged.join("\n"))
  })

  it("is not in status, which shows the connection's label only", async () => {
    const { fake } = integration()
    const read = keyReader(fake, (message) => console.warn(message))
    const ctx = {
      mcp: { list: async () => ({ data: [{ name: "specter", status: { status: "connected" } }] }) },
      agent: { list: async () => ({ data: [] }) },
      skill: { list: async () => ({ data: [] }) },
    }
    const status = await computeStatus(ctx as never, {
      access: "all",
      hostVersion: "2.4.1",
      source: () => ({ type: "plugin", url: "https://mcp.example.invalid/mcp" }),
      tools: () => ({ visible: 0, unknown: [] }),
      key: read,
      keyCheck: () => "unchecked",
      skills: [],
      problems: () => [],
      needsKey: true,
    })
    expect(status.key).toEqual({ connected: true, label: "Team key", check: "unchecked" })
    expectClean(status)
    expectClean(formatStatus(status))
    expectClean(logged.join("\n"))
  })

  it("asks status for this key's own answer, and shows an unconfirmed one as not confirmed, with its own next step", async () => {
    const { fake } = integration()
    const read = keyReader(fake, (message) => console.warn(message))
    const ctx = {
      mcp: { list: async () => ({ data: [{ name: "specter", status: { status: "connected" } }] }) },
      agent: { list: async () => ({ data: [] }) },
      skill: { list: async () => ({ data: [] }) },
    }
    const asked: string[] = []
    const status = await computeStatus(ctx as never, {
      access: "all",
      hostVersion: "2.4.1",
      source: () => ({ type: "plugin", url: "https://mcp.example.invalid/mcp" }),
      tools: () => ({ visible: 0, unknown: [] }),
      key: read,
      keyCheck: (key) => (asked.push(key), "unconfirmed"),
      skills: [],
      problems: () => [],
      needsKey: true,
    })
    expect(asked).toEqual([DUMMY_KEY])
    expect(isStatus(status)).toBe(true)
    expect(status.key.check).toBe("unconfirmed")
    expect(status.nextStep).toMatch(/neither accepted nor refused the team API key/)
    expect(formatStatus(status)).toMatch(/Team API key: connected \(Team key\), not confirmed/)
    expectClean(status)
  })
})
