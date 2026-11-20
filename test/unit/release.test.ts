import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { REST_BASE } from "../../src/constants.js"
import { SpecterPluginError } from "../../src/errors.js"
import { request } from "../../src/api/request.js"
import { checkKey } from "../../src/key-check.js"
import { configureReleaseGate, exactGitTag, installAllows, isLoopback, releaseTagIn, simulateTaggedRelease, vendorCallsAllowed, type InstallSource } from "../../src/release.js"

// The host's own report, as stock OpenCode 2.3.2 sends it: the tag is in the spec, and `version` is the resolved commit.
const SHA = "8fa625bce989ff7c47a586eaa39340374ba43434"
const packageSource = (ref: string): InstallSource => ({ type: "package", target: `git+file:///cache/opencode-specter#${ref}`, version: SHA })
const listOf = (...items: { id: string; source: InstallSource }[]) => async () => ({ location: { directory: "/p" }, data: items })

describe("a source install does not call Specter", () => {
  it("reads the tag from a package install's spec, not its commit version", () => {
    expect(installAllows(packageSource("v0.1.0"))).toBe(true)
    expect(installAllows(packageSource("v0.1.0-rc.1"))).toBe(true)
    expect(installAllows(packageSource("main"))).toBe(false)
    expect(installAllows({ type: "package", target: "github:joe-broadhead/opencode-specter" })).toBe(false)
    expect(installAllows({ type: "local", path: tmpdir() })).toBe(false)
    expect(installAllows({ type: "builtin" })).toBe(false)
    expect(installAllows({ type: "sdk" })).toBe(false)
    expect(releaseTagIn("file:///cache/@v1.2.3/dist/index.js")).toBe("v1.2.3")
    expect(releaseTagIn("github:joe-broadhead/opencode-specter#v0.1.0")).toBe("v0.1.0")
    expect(releaseTagIn(import.meta.url)).toBeUndefined()
    expect(isLoopback(new URL("http://127.0.0.1:9/"))).toBe(true)
  })

  it("treats a module URL with a release tag as released, and a source path as not", async () => {
    await expect(vendorCallsAllowed()).resolves.toBe(false)
    await expect(vendorCallsAllowed({ released: true })).resolves.toBe(true)
    await expect(vendorCallsAllowed({ moduleUrl: "file:///pkg/@v0.1.0/dist/index.js" })).resolves.toBe(true)
    simulateTaggedRelease(true)
    await expect(vendorCallsAllowed()).resolves.toBe(true)
    simulateTaggedRelease(undefined)
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

describe("the release gate reads the host's report when the entry is there", () => {
  it("is gated while the host does not list the plugin, then released once it does", async () => {
    let listed = false
    configureReleaseGate(() => async () => ({ location: { directory: "/p" }, data: listed ? [{ id: "specter.deals", source: packageSource("v0.1.0") }] : [] }))
    await expect(vendorCallsAllowed()).resolves.toBe(false) // setup: the host does not list the plugin itself
    listed = true
    await expect(vendorCallsAllowed()).resolves.toBe(true) // after setup: the entry carries the tag
  })

  it("stays gated for a package install at a branch, and for a local checkout with no tag", async () => {
    configureReleaseGate(() => listOf({ id: "specter.deals", source: packageSource("main") }))
    await expect(vendorCallsAllowed()).resolves.toBe(false)
    configureReleaseGate(() => listOf({ id: "specter.deals", source: { type: "local", path: tmpdir() } }))
    await expect(vendorCallsAllowed()).resolves.toBe(false)
  })

  it("honours the test seam over the host's report", async () => {
    configureReleaseGate(() => listOf({ id: "specter.deals", source: packageSource("main") }))
    simulateTaggedRelease(true)
    await expect(vendorCallsAllowed()).resolves.toBe(true)
    simulateTaggedRelease(undefined)
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
