import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SUPPORTED_HOST, TESTED_HOSTS } from "../../src/constants.js"
import { checkHost, isTestedHost } from "../../src/host-version.js"

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { opencode: { host: string } }
const check = readFileSync(new URL("../../scripts/check.mjs", import.meta.url), "utf8")

describe("host range", () => {
  it("is one range in package.json, src/constants.ts and the check gate", () => {
    expect(SUPPORTED_HOST).toBe(">=2.2.3 <2.4.0")
    expect(pkg.opencode.host).toBe(SUPPORTED_HOST)
    expect(check).toContain(`const HOST_RANGE = "${SUPPORTED_HOST}"`)
  })

  it("tests the family's six releases", () => {
    expect(TESTED_HOSTS).toEqual(["2.2.3", "2.2.4", "2.2.5", "2.2.6", "2.2.7", "2.3.0"])
    for (const version of TESTED_HOSTS) expect(isTestedHost(version)).toBe(true)
  })

  it("starts inside the range, untested or not, and refuses outside it unless allowed", () => {
    expect(checkHost("2.2.3", false)).toBeUndefined()
    expect(checkHost("2.2.99", false)).toBeUndefined()
    expect(isTestedHost("2.2.99")).toBe(false)
    expect(() => checkHost("2.4.0", false)).toThrow(/^HOST_UNTESTED: /)
    expect(() => checkHost("2.2.3-beta.1", false)).toThrow(/^HOST_UNTESTED: /)
    expect(checkHost("2.4.0", true)).toMatch(/allowUntestedHost/)
  })
})
