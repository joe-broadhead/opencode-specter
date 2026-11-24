// The team API key. The plugin declares its own `specter` integration with one `key` method, the way OpenCode 2.4.1's
// built-in Tavily plugin declares Tavily's (SPEC.md, "B1 — resolved"), so the key is pasted in /connect and stored by
// OpenCode as a key credential. There is deliberately no `env` method: the key never sits in an environment variable.
// The key is read at call time, kept in memory only, sent only in the X-API-Key header to Specter's REST origin
// (api/request.ts), and never put in an error, a status line, a log line or a result.
import type { Plugin } from "@opencode/plugin"
import { DISPLAY_NAME, errorText, KEY_INTEGRATION_ID, KEY_METHOD_LABEL } from "./constants.js"
import { SpecterPluginError } from "./errors.js"
import { reasonOf, shortReason, withoutSecret } from "./redact.js"

export interface SpecterKey {
  readonly key: string
  readonly source: "connected"
  /** The saved connection's label, never the key. */
  readonly label?: string
}

type IntegrationContext = { readonly integration: Pick<Plugin.Context["integration"], "transform"> }

/**
 * Declares the `specter` integration: its name in /connect and its one method, a pasted key. OpenCode checks nothing
 * at paste time (a key method has no authorize callback), so a bad key surfaces on first use or through the key check.
 * The registration is kept and disposed in cleanup. Synchronous and never throws; a failure is kept for status.
 */
export function registerKeyIntegration(ctx: IntegrationContext, report: (problem: string | undefined) => void) {
  return ctx.integration.transform((editor) => {
    try {
      editor.update(KEY_INTEGRATION_ID, (integration) => {
        integration.name = DISPLAY_NAME
      })
      editor.method.update({ integrationID: KEY_INTEGRATION_ID, method: { type: "key", label: KEY_METHOD_LABEL } })
      report(undefined)
    } catch (error) {
      report(errorText("INTEGRATION_NOT_REGISTERED", `The ${DISPLAY_NAME} key sign-in could not be added to /connect (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
}

/**
 * The active key of the `specter` integration, at call time: `connection.active`, then `connection.resolve`, used
 * only when the value is a key. Undefined when none is connected.
 */
export async function resolveKey(integration: Pick<Plugin.Context["integration"], "connection">): Promise<SpecterKey | undefined> {
  const connection = await integration.connection.active(KEY_INTEGRATION_ID)
  if (!connection) return undefined
  const value = await integration.connection.resolve(connection)
  if (value?.type !== "key") return undefined
  return { key: value.key, source: "connected", ...(connection.type === "credential" ? { label: connection.label } : {}) }
}

/**
 * Reads the key and keeps the last good one in memory: when OpenCode cannot read it, the plugin warns, without the key,
 * and keeps using the last key it read. TODO(Slice 5): `watchKey`, which re-reads on credential and integration events,
 * and the `needs_auth` mark on /connect after a rejected key, cleared after the next good call.
 */
export function keyReader(integration: Pick<Plugin.Context["integration"], "connection">, warn: (message: string) => void) {
  let last: SpecterKey | undefined
  return async (): Promise<SpecterKey | undefined> => {
    try {
      last = await resolveKey(integration)
    } catch (error) {
      // The last key read is cut out by value first, then the reason is redacted by shape and shortened.
      const reason = shortReason(withoutSecret(error instanceof Error ? error.message : String(error), last?.key)) ?? "no reason given"
      warn(errorText("KEY_UNAVAILABLE", `OpenCode could not read the ${DISPLAY_NAME} team API key (${reason}).`, `Run /connect and choose ${DISPLAY_NAME}, then paste the key again.`))
    }
    return last
  }
}
