// Plugin options. Strict: an option that is not listed here is refused with OPTIONS_INVALID rather than ignored, so a
// typo cannot silently leave the plugin more open than the user meant. Every option is optional.
import * as z from "zod"
import { ACCESS_VALUES, type Access } from "./constants.js"
import { SpecterPluginError } from "./errors.js"

/**
 * The time limit for one request to Specter's REST API, in milliseconds. The shape is opencode-tavily's
 * `executionTimeoutMs`; the numbers are not a Specter fact (docs/configuration.md, `requestTimeoutMs`). The jelly
 * declaration in package.json carries the same three numbers, and a unit test keeps them equal.
 */
export const REQUEST_TIMEOUT = { default: 30_000, min: 5_000, max: 120_000 } as const

const OptionsSchema = z.strictObject({
  /** What the generated default rules allow: everything, spend and changes ask, or free reads only. */
  access: z.enum(ACCESS_VALUES).default("all"),
  requestTimeoutMs: z
    .number()
    .int("use a whole number of milliseconds")
    .min(REQUEST_TIMEOUT.min, `use at least ${REQUEST_TIMEOUT.min}`)
    .max(REQUEST_TIMEOUT.max, `use at most ${REQUEST_TIMEOUT.max}`)
    .default(REQUEST_TIMEOUT.default),
  /** Run on an OpenCode version outside the tested range, with a warning in status. */
  allowUntestedHost: z.boolean().default(false),
})

export type Options = z.output<typeof OptionsSchema> & { readonly access: Access }

const EXAMPLE = `"plugins": [{ "package": "github:joe-broadhead/opencode-specter#v0.0.1", "options": { "access": "ask-changes" } }]`

export function loadOptions(raw: unknown): Options {
  const result = OptionsSchema.safeParse(raw ?? {})
  if (result.success) return result.data
  const issue = result.error.issues[0]
  const path = issue?.code === "unrecognized_keys" ? issue.keys[0] : issue?.path.join(".")
  const message = issue?.code === "unrecognized_keys" ? "this option does not exist" : (issue?.message ?? "invalid value")
  throw new SpecterPluginError(
    "OPTIONS_INVALID",
    path ? `Invalid plugin option "${path}": ${message}.` : `Invalid plugin options: ${message}.`,
    `Fix the plugin's options in opencode.json, for example ${EXAMPLE}.`,
  )
}
