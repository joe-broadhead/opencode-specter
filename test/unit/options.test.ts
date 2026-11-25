import { describe, expect, test } from "vitest"
import { TIMEOUT, readOptions } from "../../src/options.js"

describe("the plugin's options", () => {
  test("the defaults need no options at all", () => {
    expect(readOptions({})).toEqual({ requestTimeoutMs: TIMEOUT.default })
  })

  test("the one request setting is read within the manifest's bounds", () => {
    expect(readOptions({ requestTimeoutMs: 60_000 })).toEqual({ requestTimeoutMs: 60_000 })
    expect(() => readOptions({ requestTimeoutMs: 1000 })).toThrow(/OPTIONS_INVALID: requestTimeoutMs must be a whole number/)
    expect(() => readOptions({ requestTimeoutMs: 120_001 })).toThrow(/OPTIONS_INVALID/)
    expect(() => readOptions({ requestTimeoutMs: 1.5 })).toThrow(/OPTIONS_INVALID/)
  })

  test("an unknown option stops the plugin rather than being ignored", () => {
    expect(() => readOptions({ acess: "all" })).toThrow(/OPTIONS_INVALID: the option "acess" does not exist/)
    expect(() => readOptions({ allowUntestedHost: "yes" })).toThrow(/allowUntestedHost must be true or false/)
  })
})
