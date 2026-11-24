// Sends one request to Specter's REST API, in the structure of opencode-github's src/api/request.ts. Requests go only
// to the REST base (REST_BASE); the team key goes only to that origin, under that path, and only in the X-API-Key
// header. Redirects are handled by hand: a change (any method but GET and HEAD) never follows one; a read follows one
// within the REST base, and refuses one to another host or to plain HTTP. Bodies are read up to a cap, and results are
// capped for inline display.
//
// Retries (D6) are new to the family: a `read` call (free) is retried on 429 and 5xx and on a network failure; a
// `spend` call is never retried, because Specter may have accepted and charged the first attempt, and a retry could
// charge twice. A `write` call is not retried either: it is not known to be idempotent. Specter's own rules, from its
// public docs and unverified live (https://api.tryspecter.com/api-ref/errors.md): retry only 429 and 5xx, never 400,
// 401, 403, 404 or 422, stop on 402; on 429 wait for X-RateLimit-Reset (seconds); on 5xx back off exponentially from
// about a second. A 503 that names a wait in Retry-After gets that wait. Failures are mapped by specter-error.ts.
// The key check (key-check.ts) calls the free credit balance; the plugin's four tools (read-tools.ts) and the source
// (source/saved.ts) call the rest.
import { API_KEY_HEADER, REST_BASE } from "../constants.js"
import { isLoopback, vendorCallsAllowed } from "../release.js"
import { SpecterPluginError } from "../errors.js"
import { withoutSecret } from "../redact.js"
import type { ToolClass } from "../specter-tools.js"
import { requestIdOf, headerNumber, type SpecterError, specterErrorOf } from "./specter-error.js"

export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** Inline result cap, in bytes of JSON. */
export const MAX_INLINE_BYTES = 100_000
/** Most bytes read from one response into memory. */
export const MAX_READ_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 5
const REDIRECTS = new Set([301, 302, 303, 307, 308])
/** Attempts for a retryable call, the first included. */
export const MAX_ATTEMPTS = 3
/** The first backoff step: Specter suggests starting at about a second. */
const BASE_DELAY_MS = 1_000
/** The longest wait between attempts, a named wait included; a longer named wait ends the retries. */
export const MAX_DELAY_MS = 30_000
const TRUST = { specterContent: "untrusted" } as const

export type Method = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"

export interface RestInput {
  readonly method: Method
  /** A path relative to the REST base, such as `/searches/companies/5432/results`, as Specter's API reference gives it. */
  readonly path: string
  readonly query?: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[]>>
  readonly body?: unknown
  /** The calling tool's class: only a `read` is retried (D6). */
  readonly class: ToolClass
  /**
   * The inline cap for this answer's JSON, in bytes: MAX_INLINE_BYTES unless a caller reads for itself and keeps only
   * a field or two (the source does). A body over it is `truncated`, and a source treats that as a failure rather than
   * a short page.
   */
  readonly maxInlineBytes?: number
}

export interface RequestDeps {
  readonly key: string
  readonly fetch: Fetch
  /** The `requestTimeoutMs` option: one attempt's time limit. */
  readonly timeoutMs: number
  readonly signal?: AbortSignal
  /** Waits between attempts; a test passes its own. */
  readonly sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /** 0 to 1, for jitter; a test passes its own. */
  readonly random?: () => number
  /** The REST base; REST_BASE unless a test points at a loopback fake. */
  readonly base?: string
  /** Tests pass true to simulate a tagged release. A source install must not set this. */
  readonly released?: boolean
}

export interface ApiOutput {
  readonly ok: boolean
  readonly status: number
  readonly data?: unknown
  readonly contentType?: string
  readonly truncated: boolean
  /**
   * For an array body, how many items the provider returned, counted before the inline cap: what it charged for, and
   * how many a caller that must not lose one has to account for.
   */
  readonly itemsReturned?: number
  /** X-RateLimit-Limit, -Remaining and -Reset (seconds), as Specter's docs name them; unverified live. */
  readonly rateLimit?: { readonly limit: number; readonly remaining: number; readonly resetSeconds?: number }
  /** X-CreditLimit-Limit, -Remaining and -Reset (seconds), which Specter's docs say come on 402 and 429. */
  readonly credits?: { readonly limit: number; readonly remaining: number; readonly resetSeconds?: number }
  /** X-Request-ID, which Specter's support asks for in a report. */
  readonly requestId?: string
  /**
   * The response's `Date` header, verbatim, when it carries one: the server's clock. A source's watermark is a server
   * time, never the plugin's clock, because the provider stamps what it added with its own.
   */
  readonly serverTime?: string
  /** For a failure: the plugin's code and words, and Specter's `errorCode` when it sent one. */
  readonly error?: { readonly code: SpecterError["code"]; readonly message: string; readonly errorCode?: string }
  readonly attempts: number
  readonly nextStep?: string
  readonly trust: typeof TRUST
}

type Target = { readonly url: URL; readonly path: string }

/** Characters a path segment holds as themselves (RFC 3986 pchar); percent-encoding one only hides it. */
const PLAIN = /^[A-Za-z0-9\-._~!$&'()*+,;=:@]$/

/**
 * Builds the URL for a relative path on the REST base, and refuses anything that could leave it or that the URL parser
 * would read as another path: full URLs, `//`, `.` and `..` segments however they are encoded, an encoded plain
 * character, backslashes and control characters.
 */
export function restTarget(input: Pick<RestInput, "path" | "query">, base = REST_BASE): Target {
  const invalid = (why: string) =>
    new SpecterPluginError("API_PATH_INVALID", `The path ${JSON.stringify(input.path.slice(0, 200))} ${why}.`, "Pass a path relative to Specter's REST API, such as /companies.")
  const path = input.path
  if (!path.startsWith("/") || path.startsWith("//")) throw invalid("must start with a single /")
  if (/[\s\\#?]|[\u0000-\u001f\u007f]/.test(path)) throw invalid("has characters a path cannot have; pass the query as query")
  let decoded = path
  for (let round = 0; round < 8; round++) {
    const next = decoded.replace(/%[0-9A-Fa-f]{2}/g, (escape) => String.fromCharCode(Number.parseInt(escape.slice(1), 16)))
    if (next === decoded) break
    decoded = next
  }
  if (decoded.split(/[/\\]/).some((segment) => segment === "." || segment === "..")) throw invalid("has a . or .. segment")
  for (const escape of path.match(/%[0-9A-Fa-f]{2}/g) ?? []) {
    if (PLAIN.test(String.fromCharCode(Number.parseInt(escape.slice(1), 16)))) throw invalid(`percent-encodes ${JSON.stringify(escape)}; write the character as itself`)
  }
  if (/%(?![0-9A-Fa-f]{2})/.test(path)) throw invalid("has a % that is not an escape")
  const root = new URL(base)
  const basePath = root.pathname.replace(/\/$/, "")
  const url = new URL(`${root.origin}${basePath}${path}`)
  if (url.origin !== root.origin || url.pathname !== `${basePath}${path}`) throw invalid("is not sent as written")
  for (const [key, value] of Object.entries(input.query ?? {})) {
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(key, String(item))
  }
  return { url, path }
}

/** Whether a URL is on the REST origin and under its base path: the only place the key is sent. */
export function onRestBase(url: URL, base = REST_BASE): boolean {
  const root = new URL(base)
  const basePath = root.pathname.replace(/\/$/, "")
  // The origin holds the scheme too, so an http:// address on the same host is another origin.
  return url.origin === root.origin && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
}

const defaultSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener("abort", () => {
      clearTimeout(timer)
      reject(signal.reason)
    }, { once: true })
  })

/** Sends the request, retrying a `read` as D6 allows. */
export async function request(input: RestInput, deps: RequestDeps): Promise<ApiOutput> {
  const target = restTarget(input, deps.base)
  const retryable = input.class === "read"
  const sleep = deps.sleep ?? defaultSleep
  const random = deps.random ?? Math.random
  for (let attempt = 1; ; attempt++) {
    let response: Response
    try {
      response = await send(target.url, input, deps)
    } catch (error) {
      // A network failure or a timeout on a read is retried; anything else, or the last attempt, is reported.
      if (!retryable || attempt >= MAX_ATTEMPTS || !(error instanceof SpecterPluginError) || (error.code !== "API_UNREACHABLE" && error.code !== "API_TIMEOUT")) throw error
      await sleep(jitter(attempt, random), deps.signal)
      continue
    }
    const wait = retryable && attempt < MAX_ATTEMPTS && (response.status === 429 || response.status >= 500) ? retryWait(response, attempt, random) : undefined
    if (wait !== undefined) {
      await response.body?.cancel().catch(() => undefined)
      await sleep(wait, deps.signal)
      continue
    }
    return finish(response, await readBody(response, input.method, deps.key), attempt, input)
  }
}

/**
 * The wait before retrying a 429 or a 5xx: on a 429, X-RateLimit-Reset (seconds, possibly fractional), as Specter's
 * docs say; else Retry-After, which Specter's docs name on a 503; else backoff with jitter. Undefined when the named wait
 * is longer than MAX_DELAY_MS, which ends the retries.
 */
export function retryWait(response: Pick<Response, "status" | "headers">, attempt: number, random: () => number = Math.random): number | undefined {
  const reset = response.status === 429 ? headerNumber(response.headers, "x-ratelimit-reset") : undefined
  if (reset !== undefined) {
    const ms = Math.ceil(reset * 1000)
    return ms > MAX_DELAY_MS ? undefined : ms
  }
  return backoff(attempt, response.headers.get("retry-after"), random)
}

/**
 * The wait before the next attempt: Retry-After when Specter sends one (seconds or an HTTP date), else exponential
 * backoff with full jitter, never above MAX_DELAY_MS. A Retry-After above that cap stops the retries: the caller gets
 * the 429 with a next step that names the wait.
 */
export function backoff(attempt: number, retryAfter: string | null | undefined, random: () => number = Math.random, now = Date.now()): number | undefined {
  if (retryAfter) {
    const seconds = Number(retryAfter)
    const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - now
    if (Number.isFinite(ms)) return ms > MAX_DELAY_MS ? undefined : Math.max(0, ms)
  }
  return jitter(attempt, random)
}

/** Exponential backoff with full jitter, never above MAX_DELAY_MS. */
export function jitter(attempt: number, random: () => number = Math.random): number {
  return Math.round(random() * Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** (attempt - 1)))
}

/** One attempt, with redirects handled by hand (see the top of the file). */
async function send(url: URL, input: RestInput, deps: RequestDeps): Promise<Response> {
  const follow = input.method === "GET" || input.method === "HEAD"
  const body = input.body === undefined ? undefined : JSON.stringify(input.body)
  let current = url
  for (let hop = 0; ; hop++) {
    // The key only to the REST base: a redirect target is checked before this line runs again.
    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "specter-plugin",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(onRestBase(current, deps.base) ? { [API_KEY_HEADER]: deps.key } : {}),
    }
    const timeout = AbortSignal.timeout(deps.timeoutMs)
    const signal = deps.signal ? AbortSignal.any([deps.signal, timeout]) : timeout
    // A source install must not call Specter. A test's own fetch, a loopback fake, or a simulated release still runs.
    if (deps.fetch === fetch && !isLoopback(current) && !(await vendorCallsAllowed({ released: deps.released }))) {
      throw new SpecterPluginError(
        "NOT_RELEASED",
        "This copy is not a released install, so Specter was not called.",
        "Wait for a release tag. Do not install this repository from source if you need to call Specter.",
      )
    }
    let response: Response
    try {
      response = await deps.fetch(current.href, { method: input.method, headers, ...(body !== undefined ? { body } : {}), redirect: "manual", signal })
    } catch {
      deps.signal?.throwIfAborted()
      if (timeout.aborted) {
        throw new SpecterPluginError("API_TIMEOUT", `Specter did not answer within ${deps.timeoutMs} ms.`, "Try again; if it keeps happening, raise the plugin option requestTimeoutMs.")
      }
      throw new SpecterPluginError("API_UNREACHABLE", `Could not reach ${current.host}.`, "Check your network, then try again.")
    }
    const location = response.headers.get("location")
    if (!REDIRECTS.has(response.status) || !location) return response
    await response.body?.cancel().catch(() => undefined)
    const next = new URL(location, current)
    const what = `${input.method} ${current.pathname}`
    if (!follow) throw new SpecterPluginError("API_REDIRECTED", `Specter answered ${what} with a redirect, and a change never follows one.`, "Check the path, then call the tool again.")
    if (hop >= MAX_REDIRECTS) throw new SpecterPluginError("API_REDIRECT_LOOP", `Specter redirected more than ${MAX_REDIRECTS} times.`, "Try again later.")
    if (next.protocol !== "https:" && new URL(deps.base ?? REST_BASE).protocol === "https:") {
      throw new SpecterPluginError("API_REDIRECT_INSECURE", "Specter redirected to a non-HTTPS address.", "Try again later.")
    }
    if (!onRestBase(next, deps.base)) {
      throw new SpecterPluginError("API_REDIRECT_OFF_HOST", `Specter redirected ${what} outside its REST API, to ${next.host}, and a read follows redirects only within it.`, "Try again later; if it keeps happening, report it.")
    }
    current = next
  }
}

type Body = { data?: unknown; contentType?: string; truncated: boolean }

async function readBody(response: Response, method: Method, key: string): Promise<Body> {
  const contentType = response.headers.get("content-type")?.split(";")[0]?.trim() || undefined
  if (method === "HEAD" || response.status === 204 || !response.body) {
    await response.body?.cancel().catch(() => undefined)
    return { truncated: false, ...(contentType ? { contentType } : {}) }
  }
  const { bytes, truncated } = await readCapped(response, MAX_READ_BYTES)
  // A server or proxy that echoes the key back never gets it into a result.
  const text = withoutSecret(new TextDecoder().decode(bytes), key)
  if (contentType && /json/i.test(contentType)) {
    try {
      return { data: JSON.parse(text), contentType, truncated }
    } catch {
      return { data: text, contentType, truncated: true }
    }
  }
  return { data: text, ...(contentType ? { contentType } : {}), truncated }
}

async function readCapped(response: Response, limit: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
  const reader = response.body!.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  let truncated = false
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (size + value.byteLength > limit) {
      chunks.push(value.subarray(0, limit - size))
      size = limit
      truncated = true
      await reader.cancel().catch(() => undefined)
      break
    }
    chunks.push(value)
    size += value.byteLength
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes, truncated }
}

/** A `<prefix>-Limit`, `-Remaining` and `-Reset` header trio, as numbers. */
function meterOf(headers: Headers, prefix: string): ApiOutput["rateLimit"] {
  const limit = headerNumber(headers, `${prefix}-limit`)
  const remaining = headerNumber(headers, `${prefix}-remaining`)
  if (limit === undefined || remaining === undefined) return undefined
  const resetSeconds = headerNumber(headers, `${prefix}-reset`)
  return { limit, remaining, ...(resetSeconds !== undefined ? { resetSeconds } : {}) }
}

/** The output for a response: status, rate limit, a capped body, and a next step for failures. */
function finish(response: Response, body: Body, attempts: number, input: RestInput): ApiOutput {
  const rateLimit = meterOf(response.headers, "x-ratelimit")
  const credits = meterOf(response.headers, "x-creditlimit")
  const requestId = requestIdOf(response.headers)
  const date = response.headers.get("date")?.trim()
  const serverTime = date !== undefined && date !== "" && !Number.isNaN(Date.parse(date)) ? date : undefined
  // The error object is read before the body is capped, so a long result never hides it.
  const failure = response.ok ? undefined : specterErrorOf(response.status, body.data, response.headers, input.class)
  const inline = input.maxInlineBytes ?? MAX_INLINE_BYTES
  const capped = body.data === undefined ? undefined : capInline(body.data, inline)
  const truncated = body.truncated || capped?.truncated === true
  const itemsReturned = Array.isArray(body.data) ? body.data.length : undefined
  const nextStep = failure?.next ?? (truncated ? `The result was cut at ${inline.toLocaleString("en-GB")} bytes. Narrow the query.` : undefined)
  return {
    ok: response.ok,
    status: response.status,
    ...(capped ? { data: capped.data } : {}),
    ...(body.contentType ? { contentType: body.contentType } : {}),
    truncated,
    ...(itemsReturned === undefined ? {} : { itemsReturned }),
    ...(rateLimit ? { rateLimit } : {}),
    ...(credits ? { credits } : {}),
    ...(requestId ? { requestId } : {}),
    ...(serverTime ? { serverTime } : {}),
    ...(failure ? { error: { code: failure.code, message: failure.message, ...(failure.errorCode ? { errorCode: failure.errorCode } : {}) } } : {}),
    attempts,
    ...(nextStep ? { nextStep } : {}),
    trust: TRUST,
  }
}

/**
 * An output that failed, as the plugin's error: its code (KEY_REJECTED, OUT_OF_CREDITS, DAILY_CREDIT_CAP_REACHED or
 * UPSTREAM_ERROR), the plugin's words with Specter's request ID, and the next step; never Specter's own message.
 */
export function upstreamError(output: ApiOutput): SpecterPluginError {
  const id = output.requestId ? ` Specter request ID: ${output.requestId}.` : ""
  return new SpecterPluginError(output.error?.code ?? "UPSTREAM_ERROR", `${output.error?.message ?? `Specter answered with HTTP ${output.status}.`}${id}`, output.nextStep ?? "Run /specter-status, then try again.")
}

/** Keeps the inline result under `maxBytes`: whole list items where it can, else a cut text. */
function capInline(value: unknown, maxBytes: number): { data: unknown; truncated: boolean } {
  const size = (item: unknown) => Buffer.byteLength(typeof item === "string" ? item : (JSON.stringify(item) ?? ""))
  if (size(value) <= maxBytes) return { data: value, truncated: false }
  if (typeof value === "string") return { data: Buffer.from(value).subarray(0, maxBytes).toString("utf8"), truncated: true }
  if (Array.isArray(value)) {
    const kept: unknown[] = []
    let used = 2
    for (const item of value) {
      used += size(item) + 1
      if (used > maxBytes) break
      kept.push(item)
    }
    return { data: kept, truncated: true }
  }
  return { data: Buffer.from(JSON.stringify(value)).subarray(0, maxBytes).toString("utf8"), truncated: true }
}
