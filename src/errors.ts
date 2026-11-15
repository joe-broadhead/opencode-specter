// The plugin's own errors. Errors from OpenCode pass through unchanged. Messages never carry the team key, a token or
// raw upstream content. Each message starts with its code, because OpenCode shows only the message when a plugin fails
// to load.
import { errorText, type PluginCode } from "./constants.js"

export class SpecterPluginError extends Error {
  readonly code: PluginCode
  /** What happened, without the code or the next step. */
  readonly detail: string
  readonly nextStep: string

  constructor(code: PluginCode, message: string, nextStep: string) {
    super(errorText(code, message, nextStep))
    this.name = "SpecterPluginError"
    this.code = code
    this.detail = message
    this.nextStep = nextStep
  }
}
