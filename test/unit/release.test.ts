import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REST_BASE } from "../../src/constants.js"
import { SpecterPluginError } from "../../src/errors.js"
import { request } from "../../src/api/request.js"
import { checkKey } from "../../src/key-check.js"
import { exactGitTag, isLoopback, releaseTagIn, vendorCallsAllowed } from "../../src/release.js"

describe("a source install does not call Specter", () => {
  it("treats a module URL with a release tag as released, and a source path as not", () => {
    expect(releaseTagIn("file:///cache/@v1.2.3/dist/index.js")).toBe("v1.2.3")
    expect(releaseTagIn("github:joe-broadhead/opencode-specter#v0.1.0")).toBe("v0.1.0")
    expect(releaseTagIn(import.meta.url)).toBeUndefined()
    expect(vendorCallsAllowed()).toBe(false)
    expect(vendorCallsAllowed({ released: true })).toBe(true)
    expect(vendorCallsAllowed({ moduleUrl: "file:///pkg/@v0.1.0/dist/index.js" })).toBe(true)
    expect(isLoopback(new URL("http://127.0.0.1:9/"))).toBe(true)
  })

  it("refuses the live fetch before it sends anything", async () => {
    let called = false
    const live = (async () => {
      called = true
      return new Response(null, { status: 500 })
    }) as unknown as typeof fetch
    // The production path passes the global fetch. A stand-in that is not that function is a test fake and may run.
    await expect(
      request({ method: "GET", path: "/searches", class: "read" }, { key: "k_test", fetch, timeoutMs: 1000, base: REST_BASE }),
    ).rejects.toBeInstanceOf(SpecterPluginError)
    await expect(
      request({ method: "GET", path: "/searches", class: "read" }, { key: "k_test", fetch, timeoutMs: 1000, base: REST_BASE }),
    ).rejects.toThrow(/^NOT_RELEASED: /)
    expect(called).toBe(false)
    const sent: string[] = []
    await request(
      { method: "GET", path: "/searches", class: "read" },
      {
        key: "k_test",
        fetch: (async (input: string | URL | Request) => {
          sent.push(String(input))
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
        }) as typeof fetch,
        timeoutMs: 1000,
        base: REST_BASE,
      },
    )
    expect(sent).toEqual([`${REST_BASE}/searches`])
    expect(live).toBeTypeOf("function")
  })

  it("does not ask Specter whether a key is accepted", async () => {
    const result = await checkKey("k_test")
    expect(result).toBe("unchecked")
  })

  it("a simulated release may call the handler", async () => {
    const sent: string[] = []
    await request(
      { method: "GET", path: "/searches", class: "read" },
      {
        key: "k_test",
        released: true,
        timeoutMs: 50,
        base: "http://127.0.0.1:9",
        fetch: (async (input: string | URL | Request) => {
          sent.push(String(input))
          return new Response("[]", { status: 200, headers: { "content-type": "application/json" } })
        }) as typeof fetch,
      },
    )
    expect(sent).toEqual(["http://127.0.0.1:9/searches"])
  })
})

describe("the git-tag fallback", () => {
  it("accepts a checkout at a semver tag and refuses a source checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "specter-release-"))
    try {
      const git = (...args: string[]) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      git("init", "--quiet")
      git("-c", "user.name=release test", "-c", "user.email=release@example.invalid", "commit", "--allow-empty", "-qm", "checkout")
      expect(exactGitTag(dir)).toBe(false)
      git("tag", "v0.0.1")
      expect(exactGitTag(dir)).toBe(true)
      // A tag that is not a semver tag, on its own commit, is not a release either.
      git("-c", "user.name=release test", "-c", "user.email=release@example.invalid", "commit", "--allow-empty", "-qm", "later")
      git("tag", "0.0.2")
      expect(exactGitTag(dir)).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
