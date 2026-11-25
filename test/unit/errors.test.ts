import { describe, expect, test } from "vitest"
import { ProviderError, failureOf, keyAccepted } from "../../src/provider/errors.js"
import type { ApiOutput } from "../../src/provider/request.js"

const failure = (status: number, errorCode?: string, extra: Partial<ApiOutput> = {}): ApiOutput => ({
  ok: false,
  status,
  truncated: false,
  ...(errorCode === undefined ? {} : { error: { errorCode } }),
  attempts: 1,
  trust: { specterContent: "untrusted" },
  ...extra,
})

describe("Specter failures, as contract refusals", () => {
  test("401 and the key-refusing 403s are NEEDS_SIGN_IN, whose next step names /connect", () => {
    for (const [status, code] of [
      [401, "API_KEY_NOT_VALID"],
      [403, "org_key_disabled"],
      [403, "member_keys_disabled"],
    ] as const) {
      const error = failureOf(failure(status, code))
      expect(error.code).toBe("NEEDS_SIGN_IN")
      expect(error.message).toMatch(/^NEEDS_SIGN_IN: .* Next step: Run \/connect/)
    }
  })

  test("403 NOT_PERMITTED is the plan, not the key", () => {
    const error = failureOf(failure(403, "NOT_PERMITTED"))
    expect(error.code).toBe("UNAVAILABLE")
    expect(error.message).toMatch(/plan does not include this endpoint/)
  })

  test("402 is the provider's credit limit: RATE_LIMITED, with Specter's wait", () => {
    const error = failureOf(failure(402, "OUT_OF_CREDITS", { credits: { limit: 100, remaining: 0, resetSeconds: 3600 } }))
    expect(error.code).toBe("RATE_LIMITED")
    expect(error.retryAfterSec).toBe(3600)
    expect(failureOf(failure(402, "DAILY_CREDIT_CAP_REACHED")).what).toMatch(/daily credit limit/)
  })

  test("an expired retention cutoff is CURSOR_EXPIRED", () => {
    const error = failureOf(failure(422, "NEW_RESULTS_AFTER_BEYOND_RETENTION"))
    expect(error.code).toBe("CURSOR_EXPIRED")
    expect(error.message).toMatch(/60 days/)
  })

  test("404, 400, 422, 429, 5xx and a bare failure map by the reference", () => {
    expect(failureOf(failure(404)).code).toBe("INPUT_INVALID")
    expect(failureOf(failure(422, "NOT_SUPPORTED_PRODUCT")).what).toMatch(/not a company search/)
    expect(failureOf(failure(400, "NOT_SUPPORTED_PRODUCT")).what).toMatch(/not a company search/)
    expect(failureOf(failure(429, "RATE_LIMITED", { rateLimit: { limit: 15, remaining: 0, resetSeconds: 2 } })).retryAfterSec).toBe(2)
    expect(failureOf(failure(503, "clerk_unavailable", { requestId: "req_1234" })).message).toMatch(/request ID req_1234/)
    expect(failureOf(failure(418)).code).toBe("UNAVAILABLE")
  })

  test("a refusal is always the contract's one sentence", () => {
    const error = new ProviderError({ code: "INPUT_INVALID", what: "no such search.", next: "Pass a search id." })
    expect(error.message).toBe("INPUT_INVALID: no such search. Next step: Pass a search id.")
  })

  test("a key whose credits are spent is still a valid key for the balance read", () => {
    expect(keyAccepted(failure(402, "OUT_OF_CREDITS"))).toBe(true)
    expect(keyAccepted(failure(401))).toBe(false)
  })
})
