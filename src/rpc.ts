// The status contract shared by the server part, the /specter-status command and the TUI view. Portable and small: it
// imports only the RPC definition helper and constants, and the contract is plain JSON Schema, so the TUI bundle
// carries no zod. The TypeScript type is written out by hand, and isStatus checks a value against the same rules.
import { Rpc } from "@opencode/plugin/rpc"
import { ACCESS_VALUES, type Access, DISPLAY_NAME, PLUGIN_ID, SERVER_NAME } from "./constants.js"

/** The shared status labels' machine names. */
export const STATES = ["connected", "sign_in_required", "connecting", "failed", "disabled", "not_configured", "conflict"] as const
const EFFECTS = ["allow", "ask", "deny"] as const
const SOURCES = ["plugin", "adopted", "conflict"] as const
const KEY_CHECKS = ["accepted", "rejected", "unchecked"] as const

export type Rule = { readonly action: string; readonly resource: string; readonly effect: (typeof EFFECTS)[number] }
export type SkillPath = { readonly id: string; readonly path: string }

/**
 * Who owns the `specter` server: this plugin, the user's own config (adopted unchanged when it points at Specter's
 * URL), or a server at another URL. URLs are origin and path only.
 */
export type ServerSource =
  | { readonly type: "plugin"; readonly url: string }
  | { readonly type: "adopted"; readonly url: string; readonly signIn: "oauth" | "own" }
  | { readonly type: "conflict"; readonly url: string; readonly expected: string }

/** In the order the dialog and /specter-status show it. version, host, state, unguardedAgents and nextStep are the shared fields. */
export type Status = {
  readonly version: string
  /** The MCP server's state: the per-person sign-in. */
  readonly state: (typeof STATES)[number]
  readonly server?: { readonly type: (typeof SOURCES)[number]; readonly url: string; readonly expected?: string; readonly signIn?: "oauth" | "own" }
  /** The team key: whether one is connected, its connection label (never the key), and the last key check. */
  readonly key: { readonly connected: boolean; readonly label?: string; readonly check: (typeof KEY_CHECKS)[number] }
  readonly access: Access
  /** The specter server's tools that agents can use, and the ones the plugin has not classified yet. */
  readonly tools: { readonly visible: number; readonly unknown: readonly string[] }
  readonly unguardedAgents: readonly string[]
  readonly permissionsBlock?: readonly Rule[]
  readonly shadowedSkills?: readonly SkillPath[]
  /** Registration problems, each `CODE: what. Next step: what.` Present only when there are any. */
  readonly problems?: readonly string[]
  readonly host: { readonly version: string; readonly range: string; readonly tested: boolean }
  readonly hostWarning?: string
  readonly nextStep: string
}

const text = { type: "string" } as const
const texts = { type: "array", items: text } as const
const object = (properties: Record<string, object>, required: readonly string[]) =>
  ({ type: "object", properties, required, additionalProperties: false }) as const

const rule = object({ action: text, resource: text, effect: { enum: EFFECTS } }, ["action", "resource", "effect"])
const skillPath = object({ id: text, path: text }, ["id", "path"])

export const STATUS_SCHEMA = object(
  {
    version: text,
    state: { enum: STATES },
    server: object({ type: { enum: SOURCES }, url: text, expected: text, signIn: { enum: ["oauth", "own"] } }, ["type", "url"]),
    key: object({ connected: { type: "boolean" }, label: text, check: { enum: KEY_CHECKS } }, ["connected", "check"]),
    access: { enum: ACCESS_VALUES },
    tools: object({ visible: { type: "integer", minimum: 0 }, unknown: texts }, ["visible", "unknown"]),
    unguardedAgents: texts,
    permissionsBlock: { type: "array", items: rule },
    shadowedSkills: { type: "array", items: skillPath },
    problems: texts,
    host: object({ version: text, range: text, tested: { type: "boolean" } }, ["version", "range", "tested"]),
    hostWarning: text,
    nextStep: text,
  },
  ["version", "state", "key", "access", "tools", "unguardedAgents", "host", "nextStep"],
)

export const SpecterRpc = Rpc.define({
  id: PLUGIN_ID,
  methods: {
    status: {
      input: object({}, []),
      output: STATUS_SCHEMA,
      errors: { unavailable: object({ reason: text }, ["reason"]) },
    },
  },
  events: {},
})

type Record_ = Record<string, unknown>
const isRecord = (value: unknown): value is Record_ => typeof value === "object" && value !== null && !Array.isArray(value)
const isText = (value: unknown): value is string => typeof value === "string"
const isTexts = (value: unknown) => Array.isArray(value) && value.every(isText)
const only = (value: Record_, keys: readonly string[]) => Object.keys(value).every((key) => keys.includes(key))
const optional = (value: unknown, check: (value: unknown) => boolean) => value === undefined || check(value)
const oneOf = (values: readonly unknown[]) => (value: unknown) => values.includes(value)
const isRule = (value: unknown) =>
  isRecord(value) && only(value, ["action", "resource", "effect"]) && isText(value.action) && isText(value.resource) && EFFECTS.includes(value.effect as never)
const isSkillPath = (value: unknown) => isRecord(value) && only(value, ["id", "path"]) && isText(value.id) && isText(value.path)

/** JSON Schema outputs reach clients unchecked, so readers check a status against the schema's rules. */
export function isStatus(value: unknown): value is Status {
  if (!isRecord(value) || !only(value, Object.keys(STATUS_SCHEMA.properties))) return false
  const { server, key, tools, host } = value
  return (
    isText(value.version) &&
    STATES.includes(value.state as never) &&
    optional(server, (item) => isRecord(item) && only(item, ["type", "url", "expected", "signIn"]) && oneOf(SOURCES)(item.type) && isText(item.url) && optional(item.expected, isText) && optional(item.signIn, oneOf(["oauth", "own"]))) &&
    isRecord(key) && only(key, ["connected", "label", "check"]) && typeof key.connected === "boolean" && optional(key.label, isText) && oneOf(KEY_CHECKS)(key.check) &&
    ACCESS_VALUES.includes(value.access as never) &&
    isRecord(tools) && only(tools, ["visible", "unknown"]) && Number.isInteger(tools.visible) && (tools.visible as number) >= 0 && isTexts(tools.unknown) &&
    isTexts(value.unguardedAgents) &&
    optional(value.permissionsBlock, (block) => Array.isArray(block) && block.every(isRule)) &&
    optional(value.shadowedSkills, (skills) => Array.isArray(skills) && skills.every(isSkillPath)) &&
    optional(value.problems, isTexts) &&
    isRecord(host) && only(host, ["version", "range", "tested"]) && isText(host.version) && isText(host.range) && typeof host.tested === "boolean" &&
    optional(value.hostWarning, isText) &&
    isText(value.nextStep)
  )
}

const STATE_LABELS: Record<Status["state"], string> = {
  connected: "connected",
  sign_in_required: "sign-in required",
  connecting: "connecting",
  failed: "failed",
  disabled: "disabled",
  not_configured: "not configured",
  conflict: "conflict",
}

export const NOTHING_TO_DO = "Nothing to do."
export const STATUS_COMMAND = `${SERVER_NAME}-status`

/** The next step for agents without the default rules: one fixed sentence across the plugins, with no names. */
export const AGENT_STEP = `Put the default rules shown by /${STATUS_COMMAND} first in each listed agent's own permissions, in opencode.json or the agent's Markdown file, followed by your top-level rules for ${DISPLAY_NAME} tools.`

const NONE = "none"

export type StatusRow = { readonly label: string; readonly value: string }

export function formatRules(rules: readonly Rule[]): string {
  return `[\n${rules.map((item) => `  ${JSON.stringify(item)}`).join(",\n")}\n]`
}

const ACCESS_TEXT: Record<Access, string> = {
  all: "every tool runs without asking, credit spend, changes and new tools included",
  "ask-changes": "free reads run without asking; every call that spends credits, every change and every new tool asks first",
  "read-only": "free reads run without asking; every call that spends credits, every change and every new tool is denied",
}

const KEY_CHECK_TEXT: Record<Status["key"]["check"], string> = {
  accepted: "accepted by Specter",
  rejected: "rejected by Specter",
  unchecked: "not checked",
}

function describeServer(server: Status["server"]): string {
  if (!server) return "not registered yet"
  if (server.type === "plugin") return `${server.url}, registered by the plugin`
  if (server.type === "adopted") return `${server.url}, your own mcp.servers.${SERVER_NAME}${server.signIn === "own" ? " without OAuth" : ""}, used unchanged`
  return `${server.url}, your own mcp.servers.${SERVER_NAME}, not Specter's ${server.expected ?? ""}`.trim()
}

function describeKey(key: Status["key"]): string {
  if (!key.connected) return "none connected"
  return `${key.label ? `connected (${key.label})` : "connected"}, ${KEY_CHECK_TEXT[key.check]}`
}

function describeTools(tools: Status["tools"]): string {
  const visible = `${tools.visible} available`
  return tools.unknown.length === 0 ? visible : `${visible}, ${tools.unknown.length} not yet classified (treated as changes): ${tools.unknown.join(", ")}`
}

function describeHost(status: Pick<Status, "host" | "hostWarning">): string {
  if (status.host.tested) return `${status.host.version} (tested)`
  if (status.hostWarning) return `${status.host.version} (untested: ${status.hostWarning})`
  return `${status.host.version} (untested; supported range ${status.host.range})`
}

/** The status as labelled rows, in the order the dialog and /specter-status show them. */
export function statusRows(status: Status): StatusRow[] {
  return [
    { label: "Connection", value: STATE_LABELS[status.state] },
    { label: "Server", value: describeServer(status.server) },
    { label: "Team API key", value: describeKey(status.key) },
    // The two sign-ins are separate: the MCP sign-in is per person, the key is the team's (SPEC.md §5).
    { label: "Sign-ins", value: "the MCP sign-in is yours alone; the team API key is shared, and every call with it spends from one credit pool" },
    // TODO(Slice 0): whether MCP calls spend credits is unmeasured.
    { label: "MCP credit use", value: "not yet known" },
    { label: "Access", value: ACCESS_TEXT[status.access] },
    { label: "Tools", value: describeTools(status.tools) },
    { label: "Agents without default rules", value: status.unguardedAgents.length > 0 ? status.unguardedAgents.join(", ") : NONE },
    ...(status.shadowedSkills?.length ? [{ label: "Skills", value: status.shadowedSkills.map((skill) => `${skill.id} replaced by ${skill.path}`).join("; ") }] : []),
    ...(status.problems?.length ? [{ label: "Problems", value: status.problems.join(" ") }] : []),
    { label: "OpenCode", value: describeHost(status) },
    { label: "Next step", value: status.nextStep },
  ]
}

const STATUS_TITLE = `${DISPLAY_NAME} status`

export function formatStatus(status: Status): string {
  const lines: string[] = [STATUS_TITLE]
  for (const row of statusRows(status)) {
    lines.push(`${row.label}: ${row.value}`)
    if (row.label === "Agents without default rules" && status.unguardedAgents.length > 0) lines.push(formatRules(status.permissionsBlock ?? []))
  }
  return lines.join("\n")
}
