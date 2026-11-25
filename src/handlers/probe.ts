// `probe`: whose the team key is, and nothing it reads. The key names no person, so the owner is the key's fingerprint
// (`specter:key:<hex>`), never a person or an organisation Specter does not report.
import { PROBE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import { refuse } from "../provider/errors.js"
import { SOURCE } from "../provider/saved.js"
import { STRING } from "./schemas.js"
import type { HandlerDeps } from "./types.js"

export function createProbeHandler(deps: HandlerDeps) {
  return {
    description: "Read whose team key is connected (the key's fingerprint), without reading any company.",
    input: { type: "object", properties: { source: STRING }, additionalProperties: false },
    output: PROBE_SCHEMA,
    async run(input: Readonly<Record<string, unknown>>, call: { readonly account: string; readonly signal: AbortSignal }) {
      if (input["source"] !== undefined && input["source"] !== SOURCE) {
        refuse("SOURCE_UNKNOWN", `This plugin's saved-search source is "${SOURCE}"`, `Pass source "${SOURCE}", or leave it out.`)
      }
      const owner = await deps.provider.owner(call.signal)
      return { source: SOURCE, account: call.account, owner, trust: "untrusted" }
    },
  }
}
