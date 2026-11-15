import { describe, expect, it } from "vitest"
import { loadOptions, REQUEST_TIMEOUT } from "../../src/options.js"

describe("options", () => {
  it("defaults: access all (D1), the request time limit, and no untested hosts", () => {
    expect(loadOptions(undefined)).toEqual({ access: "all", requestTimeoutMs: REQUEST_TIMEOUT.default, allowUntestedHost: false })
    expect(loadOptions({})).toEqual(loadOptions(undefined))
  })

  it("takes every documented value", () => {
    expect(loadOptions({ access: "read-only", requestTimeoutMs: REQUEST_TIMEOUT.max, allowUntestedHost: true })).toEqual({
      access: "read-only",
      requestTimeoutMs: REQUEST_TIMEOUT.max,
      allowUntestedHost: true,
    })
  })

  it("refuses an unknown option with OPTIONS_INVALID, naming it", () => {
    expect(() => loadOptions({ acess: "all" })).toThrow(/^OPTIONS_INVALID: Invalid plugin option "acess": this option does not exist\. Next step: /)
  })

  it("refuses a wrong value with OPTIONS_INVALID", () => {
    expect(() => loadOptions({ access: "read" })).toThrow(/OPTIONS_INVALID/)
    expect(() => loadOptions({ requestTimeoutMs: "30000" })).toThrow(/OPTIONS_INVALID/)
    expect(() => loadOptions({ allowUntestedHost: "yes" })).toThrow(/OPTIONS_INVALID/)
    expect(() => loadOptions([])).toThrow(/OPTIONS_INVALID/)
  })
})
