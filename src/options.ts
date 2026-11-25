// The plugin's options, read strictly: an unknown key or a bad value is OPTIONS_INVALID, never silently ignored, so a
// typo cannot leave the plugin more open than the person meant. `access` and `accounts` are the contract modules' own
// (they refuse their invalid values); this file covers the plugin-specific ones and the unknown keys.
/** The options the manifest declares, and nothing else. */
const KNOWN_OPTIONS = new Set(["access", "accounts", "allowUntestedHost", "requestTimeoutMs"])
/** The `requestTimeoutMs` bounds, as the manifest's options schema declares them. */
export const TIMEOUT = { default: 30_000, min: 5_000, max: 120_000 } as const

export function optionsInvalid(reason: string): never {
  throw new Error(`OPTIONS_INVALID: ${reason} Next step: fix the plugin's options in opencode.json, then reload OpenCode.`)
}

/** Reads the plugin's options, and names the one request setting it keeps. */
export function readOptions(raw: Readonly<Record<string, unknown>>): { readonly requestTimeoutMs: number } {
  for (const key of Object.keys(raw)) if (!KNOWN_OPTIONS.has(key)) optionsInvalid(`the option "${key}" does not exist.`)
  const timeout = raw["requestTimeoutMs"]
  if (timeout !== undefined && (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout < TIMEOUT.min || timeout > TIMEOUT.max)) {
    optionsInvalid(`requestTimeoutMs must be a whole number of milliseconds from ${TIMEOUT.min} to ${TIMEOUT.max}.`)
  }
  const allow = raw["allowUntestedHost"]
  if (allow !== undefined && typeof allow !== "boolean") optionsInvalid("allowUntestedHost must be true or false.")
  return { requestTimeoutMs: (timeout as number | undefined) ?? TIMEOUT.default }
}
