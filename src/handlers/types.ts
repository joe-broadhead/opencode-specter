// What every handler gets from setup. Structural types only: a handler never imports a host package or a registration.
import type { Manifest } from "@we-the-rebel-alliance/plugin-contract/manifest"
import type { SpecterProvider } from "../provider/specter.js"

/** One MCP server as OpenCode reports it, cut to what status needs. */
export interface ServerView {
  readonly name: string
  readonly state: "connected" | "pending" | "disabled" | "failed" | "needs_auth"
  readonly error?: string
}

/** The plugin's dependencies, built once in setup and closed over by the handlers. */
export interface HandlerDeps {
  readonly manifest: Manifest
  /** The installed package's version, as status reports it. */
  readonly version: string
  /** The plugin's options, including `accounts`. */
  readonly options: Readonly<Record<string, unknown>>
  /** The running OpenCode release, read once in setup. */
  readonly hostVersion: string
  /** The Specter REST client. */
  readonly provider: SpecterProvider
  /** OpenCode's MCP servers, for status. */
  readonly servers: () => Promise<readonly ServerView[]>
  /** Registration problems, each one sentence; status shows them. */
  readonly problems: () => readonly string[]
}
