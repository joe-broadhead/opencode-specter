// Text from OpenCode, Specter or the network, made safe to show in status, a tool result, an error or the session.
// The rule this file exists for: the team key never reaches an error, a status line, a log line or a result, not
// whole, not in part. Everything that leaves the plugin's own code, and every `catch`, goes through `redact` or
// `reasonOf` first. No imports: the terminal UI entry may inline it too. Ported from the earlier skeleton.

/**
 * Token shapes: bearer and basic values, `key=value` pairs including an `X-API-Key` header, JWTs, vendor-prefixed
 * keys, and any long run of key characters. The last pattern is the one that catches Specter's team key whatever its
 * shape (the key's format is not documented), so a key copied into an error by a transport library still never
 * survives. Callers that hold the key also cut it out by value (`withoutSecret`), which needs no guess at its shape.
 */
const SECRETS: readonly (readonly [RegExp, string])[] = [
  [/\b(bearer|basic|token)\s+[\w.~+/=-]{8,}/gi, "$1 [redacted]"],
  [
    /\b([\w-]*(?:api[_-]?key|access[_-]?key|private[_-]?key|token|secret|password|signature|credential)["']?\s*[:=]\s*)["']?[^\s"'&,;]+["']?/gi,
    "$1[redacted]",
  ],
  [/\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/g, "[redacted]"],
  [/\b(?:sk|pk|rk|ghp|gho|ghu|ghs|ghr|github_pat|glpat|xox[abposr]|lin_api|lin_oauth)[-_][\w-]{8,}/gi, "[redacted]"],
  [/[\w+=-]{40,}/g, "[redacted]"],
]

const REASON_LIMIT = 160

/** C0 and C1 controls and DEL: a line break or escape sequence must not reach a terminal or the session. */
const CONTROLS = /[\u0000-\u001f\u007f-\u009f]+/g
/** Bidi marks, embeddings, overrides and isolates: a name must not reorder the row it is shown in. */
const BIDI = /[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g

/** A URL in text keeps its scheme, host and path: its `user:password@`, query and fragment go. */
const withoutUrlSecrets = (text: string) =>
  text.replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (url) => url.replace(/^(https?:\/\/)[^/?#@]*@/i, "$1").replace(/[?#].*$/s, ""))

/** One line with no controls or bidi characters, whitespace collapsed. */
export const oneLine = (text: string) => text.replace(BIDI, "").replace(CONTROLS, " ").replace(/\s+/g, " ").trim()

/** At most `limit` characters, cut between whole characters (never inside a surrogate pair), ending in `…` when cut. */
export function cut(text: string, limit: number) {
  const characters = Array.from(text)
  return characters.length > limit ? `${characters.slice(0, limit - 1).join("")}…` : text
}

/**
 * Text safe to put in an error, a tool result or a log line: token shapes redacted, a URL's credentials, query and
 * fragment removed, one line, and nothing hidden in a control or bidi character.
 */
export function redact(text: string): string {
  return oneLine(SECRETS.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), withoutUrlSecrets(text)))
}

/**
 * Host or network text as a short reason: redacted, trailing punctuation dropped, and at most 160 characters. Undefined
 * when nothing is left, so a caller can leave the reason out rather than printing an empty bracket.
 */
export function shortReason(text: string): string | undefined {
  const reason = redact(text).replace(/[.\s]+$/, "")
  if (reason === "") return undefined
  return cut(reason, REASON_LIMIT)
}

/** An error's message, or the value itself, as a short redacted reason; `fallback` when nothing is left. */
export const reasonOf = (error: unknown, fallback = "no reason given") =>
  shortReason(error instanceof Error ? error.message : String(error)) ?? fallback

/** `text` with every occurrence of `secret` replaced, so a key echoed back by a server or a library cannot survive. */
export function withoutSecret(text: string, secret: string | undefined): string {
  if (!secret || secret.length < 4) return text
  return text.split(secret).join("[redacted]")
}
