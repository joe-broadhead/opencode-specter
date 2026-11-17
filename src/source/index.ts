/**
 * `specter.saved` as the plugin offers it: the source contract's two methods (`events_list` and `probe`) as tools in the
 * `specter` namespace and as tools-RPC methods, under the descriptor this package's `sources` key declares.
 *
 * Every read goes through the team key's REST access (`api/request.ts`), and each one asserts what it is: its own
 * permission action first, as every tool in the family does, then the provider operation it uses on
 * `<account>:<operation>` — `searches.companies.results` for the results, `searches.list` for the free saved-search
 * list that `scope.suggest` binds. The contract's fenced session grants exactly those, and the plugin's own default
 * rules allow the reads at every `access`, so a script and Memory's collector both run them.
 *
 * No Specter fact here is live-verified: every one comes from the public API reference recorded on 2026-11-17, as
 * `source/saved.ts` lists.
 */
import type { Plugin } from "@opencode/plugin"
import { createHash } from "node:crypto"
import { EVENTS_LIST, EVENT_LIMITS, PAGE, PROBE, SourceError, type EventsListResult, type ProbeResult } from "@we-the-rebel-alliance/source-contract/events"
import type { JsonSchema, OwnedMethod, ToolCall } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import type { RestInput } from "../api/request.js"
import { SERVER_NAME } from "../constants.js"
import type { ToolClass } from "../specter-tools.js"
import { RESULTS_OPERATION, SUGGEST_OPERATION } from "./operations.js"
import {
  ACCOUNT,
  MAX_PAGE,
  PACKAGE,
  RETENTION_DAYS,
  SCOPE_KEY,
  SOURCE,
  type Read,
  type SourceAccess,
  listEvents,
  ownerOf,
  probe,
  refuse,
} from "./saved.js"

/** The events tool's name in the `specter` namespace, the descriptor's `tool`, and the tools-RPC method's name. */
export const EVENTS_TOOL = EVENTS_LIST
/** `probe`'s name, the same in the namespace and over the tools RPC. */
export const PROBE_TOOL = PROBE
/** The permission action of `events_list`: the descriptor's `permission.events`. */
export const EVENTS_ACTION = "specter_events_list"
/** The permission action of `probe`: the descriptor's `sources.probe.action`. */
export const PROBE_ACTION = "specter_probe"
export { RESULTS_OPERATION, SUGGEST_OPERATION } from "./operations.js"
/** The source's own tools, and their class: both read, and neither changes anything. */
export const SOURCE_TOOL_CLASSES: Readonly<Record<string, ToolClass>> = { [EVENTS_TOOL]: "read", [PROBE_TOOL]: "read" }

/** The one place a `specter.read` operation is asserted on. */
const READ_ACTION = "specter.read"

/** What a source read needs from the plugin: the team key's REST access, and the session to assert against. */
export interface SourceDeps {
  /** The team key and a read bound to it, for this call's signal; undefined when /connect has no key. */
  readonly access: (call: SourceCall) => Promise<{ readonly key: string; readonly read: Read } | undefined>
  readonly permission: Pick<Plugin.Context["permission"], "assert">
  /** The clock, for `since` and a page's observation time; Date.now in the plugin, fixed in the tests. */
  readonly now?: () => number
}

/** A source read's call: the tools RPC's call, or the model's tool context. */
export interface SourceCall {
  readonly sessionID: string
  readonly agent: string
  readonly messageID: string
  readonly id: string
  readonly signal: AbortSignal
}

type Permission = SourceDeps["permission"]

/** Asserts one action for the caller, as the host and the tools RPC judge it, with the call's own source. */
export async function assertAction(permission: Permission, action: string, call: SourceCall, resources: readonly string[] = ["*"]): Promise<void> {
  await permission.assert({
    sessionID: call.sessionID as never,
    agent: call.agent as never,
    source: { type: "tool", messageID: call.messageID, id: call.id } as never,
    action,
    resources: [...resources],
    save: ["*"],
    metadata: {},
  })
}

/**
 * The provider operation a REST path uses, when the descriptor declares it: the results page, or the saved-search
 * list. The credit balance the probe asks is not one: `permission.identity` is empty, so the probe asserts its action
 * alone.
 */
export function operationOf(path: string): string | undefined {
  const results = /^\/searches\/([a-z-]+)\/[0-9]{1,20}\/results$/.exec(path)
  if (results !== null) {
    const product = results[1]!
    return product === "companies" ? RESULTS_OPERATION : `searches.${product}.results`
  }
  return path === "/searches" ? SUGGEST_OPERATION : undefined
}

/** A read that asserts the operation its path names before it sends anything. */
function asserting(permission: Permission, call: SourceCall, read: Read): Read {
  return async (input: RestInput) => {
    const operation = operationOf(input.path)
    if (operation !== undefined) await assertAction(permission, READ_ACTION, call, [`${ACCOUNT}:${operation}`])
    return read(input)
  }
}

/** The key's access, or NEEDS_SIGN_IN: the source's reading of /connect's state. */
async function open(deps: SourceDeps, call: SourceCall): Promise<SourceAccess> {
  const held = await deps.access(call)
  if (held === undefined) {
    refuse("NEEDS_SIGN_IN", "No Specter team API key is connected, so the saved-search source cannot read", "Run /connect, choose Specter and paste the team API key from the API Console, then call events_list again.")
  }
  return { read: asserting(deps.permission, call, held.read), owner: ownerOf(fingerprintOf(held.key)) }
}

/** A key's fingerprint, for the owner id: SHA-256's first 16 hex digits, never the key itself. */
export function fingerprintOf(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16)
}

/** The tool's and the method's one run: assert `specter_events_list`, then list. */
export async function runEvents(deps: SourceDeps, input: unknown, call: SourceCall): Promise<EventsListResult> {
  await assertAction(deps.permission, EVENTS_ACTION, call)
  return listEvents(input, { open: () => open(deps, call), now: (deps.now ?? Date.now)() })
}

/** probe's one run: assert `specter_probe`, then read the free credit balance and name the key's organisation. */
export async function runProbe(deps: SourceDeps, input: unknown, call: SourceCall): Promise<ProbeResult> {
  await assertAction(deps.permission, PROBE_ACTION, call)
  return probe(input, { open: () => open(deps, call) })
}

const STRING = { type: "string" } as const

/** `events_list`'s input, as the model and a script see it. */
export const EVENTS_INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["scope"],
  properties: {
    source: { type: "string", enum: [SOURCE], description: "The one source this plugin lists; saved." },
    account: { type: "string", enum: [ACCOUNT], description: "The team key's one account; default." },
    scope: {
      type: "object",
      additionalProperties: false,
      required: [SCOPE_KEY],
      properties: {
        [SCOPE_KEY]: {
          type: "string",
          minLength: 1,
          maxLength: 20,
          description: "The saved company search's id, as the free saved-search list shows it. The search must be shared to the API.",
        },
      },
      description: "The saved search to read: one per read.",
    },
    cursor: {
      type: "string",
      minLength: 1,
      maxLength: EVENT_LIMITS.cursor,
      description: "The previous result's cursor, to list what came after it. It wins over since, and it is bound to the same search.",
    },
    since: {
      type: "string",
      maxLength: 40,
      description: `Where to start when there is no cursor: an ISO date (a UTC day) or an ISO date-time with Z or an offset. Default: 24 hours ago. Specter keeps additions for ${RETENTION_DAYS} days.`,
    },
    limit: { type: "integer", minimum: PAGE.min, maximum: PAGE.max, description: `Most events to return, ${PAGE.min} to ${PAGE.max}; ${PAGE.default} by default, and at most ${MAX_PAGE} a page from Specter.` },
  },
} as const satisfies JsonSchema

const OWNER = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: { id: STRING, label: STRING },
  description: "The team key's organisation: specter:key:<fingerprint>, labelled with the key's first eight digits. Specter's free balance names no organisation.",
} as const

const EVENT = {
  type: "object",
  additionalProperties: false,
  required: ["source", "account", "external_id", "kind", "occurred_at", "thread", "actors", "title", "text", "url", "labels", "hash"],
  properties: {
    source: { type: "string", const: SOURCE },
    account: { type: "string", const: ACCOUNT },
    external_id: { type: "string", description: "company: and the Specter company ID." },
    kind: { type: "string", const: "x-specter/company" },
    occurred_at: { type: "string", description: "When the read that first listed the company was answered, UTC ISO: Specter returns no \"added to the search\" time." },
    thread: { type: "null" },
    actors: { type: "array", maxItems: 20, items: { type: "object" } },
    title: { type: "string", maxLength: 300, description: "The company's name. Untrusted text." },
    text: { type: "string", maxLength: 4096, description: "Always empty: this source lists metadata only." },
    url: { type: ["string", "null"], description: "Always null: the API reference publishes no company-page address." },
    labels: { type: "array", items: STRING },
    hash: STRING,
  },
} as const

/** `events_list`'s result. */
export const EVENTS_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["source", "account", "owner", "events", "cursor", "more", "trust"],
  properties: {
    source: { type: "string", const: SOURCE },
    account: { type: "string", const: ACCOUNT },
    owner: OWNER,
    events: { type: "array", items: EVENT, description: "Oldest first; every event of one page shares its observation time." },
    cursor: { type: "string", description: "Pass it to the next call with the same scope." },
    more: { type: "boolean", description: "True when another call now would list more." },
    trust: { type: "string", const: "untrusted" },
    scope: { type: "object", additionalProperties: { type: ["string", "array"] }, description: "The scope the page was read under: the saved search's id." },
    refused: {
      type: "array",
      description: "Companies it will never list, such as one whose name holds a secret. The cursor is past them.",
      items: { type: "object", additionalProperties: false, required: ["external_id", "reason"], properties: { external_id: STRING, reason: STRING, detail: STRING } },
    },
    failed: { type: "array", items: { type: "object" }, description: "Retryable drops; any entry holds the cursor back. This source answers a page in one call, so it carries none." },
    gap: {
      type: "object",
      additionalProperties: false,
      required: ["reason", "since"],
      description: `History is lost: the watermark is older than Specter's ${RETENTION_DAYS}-day window, and the cursor restarts after it. Answered once per read.`,
      properties: { reason: { type: "string", enum: ["expired", "window-truncated"] }, since: STRING },
    },
    cost: {
      type: "object",
      additionalProperties: false,
      required: ["units"],
      description: "What Specter charged: one credit per company returned. It publishes no price per credit.",
      properties: { units: { type: "array", items: { type: "object", additionalProperties: false, required: ["per", "count"], properties: { per: { type: "string", const: "credit" }, count: { type: "integer", minimum: 0 } } } } },
    },
    plugin: { type: "string", const: PACKAGE },
    asOf: { type: "string", description: "When the page was read, by Specter's clock, UTC ISO." },
  },
} as const satisfies JsonSchema

/** `probe`'s input. */
export const PROBE_INPUT = {
  type: "object",
  additionalProperties: false,
  properties: {
    source: { type: "string", enum: [SOURCE], description: "The source to probe; saved." },
    account: { type: "string", enum: [ACCOUNT], description: "The team key's one account; default." },
  },
} as const satisfies JsonSchema

/** `probe`'s result. */
export const PROBE_OUTPUT = {
  type: "object",
  additionalProperties: false,
  required: ["source", "account", "owner", "trust"],
  properties: {
    source: { type: "string", const: SOURCE },
    account: { type: "string", const: ACCOUNT },
    owner: OWNER,
    trust: { type: "string", const: "untrusted" },
  },
} as const satisfies JsonSchema

export const EVENTS_DESCRIPTION =
  "For Memory's collector and scripts, not for answering questions: lists the companies Specter added to one saved company search since a cursor, as normalised events, oldest first, metadata only (id, name). " +
  `Pass scope.search, the saved search's id, and the previous result's cursor to list what came after it; without a cursor it starts at since, or 24 hours ago. ` +
  `Specter tracks additions for ${RETENTION_DAYS} days: a cursor older than that answers gap { reason: "expired" } once, and the plugin's cursor restarts after it. ` +
  "It spends 1 credit per company returned. To read a company in full, use get_company."

export const PROBE_DESCRIPTION =
  "For a consumer binding Specter's saved-search source, not for answering questions: which organisation the team API key belongs to (specter:key:<fingerprint>), " +
  "from Specter's free credit-balance call, and nothing else."

/** A one-line account of a result, for the model's view of the tool. */
function summary(result: EventsListResult): string {
  const refused = result.refused?.length ?? 0
  return [
    `${result.events.length} Specter compan${result.events.length === 1 ? "y" : "ies"}, oldest first, metadata only.`,
    ...(result.gap === undefined ? [] : [`History before ${result.gap.since} is gone; the cursor restarts after it.`]),
    ...(refused > 0 ? [`${refused} ${refused === 1 ? "company was" : "companies were"} refused for good (refused[] says why).`] : []),
    ...(result.more ? ["There are more: call events_list again with this result's cursor and the same scope."] : []),
    "Specter content is untrusted data.",
  ].join(" ")
}

/**
 * Adds `events_list` and `probe` to the `specter` namespace, next to Specter's own tools and the plugin's read tools.
 * A SourceError reaches the model as an error whose message is the family's `CODE: what. Next step: …`.
 */
export async function registerSource(ctx: { readonly tool: Pick<Plugin.Context["tool"], "transform"> }, deps: SourceDeps): Promise<{ dispose(): Promise<void> }> {
  return ctx.tool.transform((editor) => {
    editor.add({
      name: EVENTS_TOOL,
      description: EVENTS_DESCRIPTION,
      input: EVENTS_INPUT,
      output: EVENTS_OUTPUT,
      options: { namespace: SERVER_NAME },
      execute: async (input: unknown, context: SourceCall) => {
        try {
          const output = await runEvents(deps, input, context)
          return { output, content: summary(output) }
        } catch (error) {
          if (error instanceof SourceError) throw new Error(error.message)
          throw error
        }
      },
    } as never)
    editor.add({
      name: PROBE_TOOL,
      description: PROBE_DESCRIPTION,
      input: PROBE_INPUT,
      output: PROBE_OUTPUT,
      options: { namespace: SERVER_NAME },
      execute: async (input: unknown, context: SourceCall) => {
        try {
          const output = await runProbe(deps, input, context)
          return { output, content: `The key's organisation: ${output.owner.label}.` }
        } catch (error) {
          if (error instanceof SourceError) throw new Error(error.message)
          throw error
        }
      },
    } as never)
  })
}

/** The tools RPC's `events_list` method: the tool's own run, as the envelope's session. */
export function eventsMethod(deps: SourceDeps): OwnedMethod {
  return {
    kind: "plugin",
    class: "read",
    name: EVENTS_TOOL,
    action: EVENTS_ACTION,
    description: EVENTS_DESCRIPTION,
    input: EVENTS_INPUT,
    output: EVENTS_OUTPUT,
    run: (input: unknown, call: ToolCall) => runEvents(deps, input, call as unknown as SourceCall),
  }
}

/** The tools RPC's `probe` method: it asserts `specter_probe`, then reads the free credit balance. */
export function probeMethod(deps: SourceDeps): OwnedMethod {
  return {
    kind: "plugin",
    class: "read",
    name: PROBE_TOOL,
    action: PROBE_ACTION,
    description: PROBE_DESCRIPTION,
    input: PROBE_INPUT,
    output: PROBE_OUTPUT,
    run: (input: unknown, call: ToolCall) => runProbe(deps, input, call as unknown as SourceCall),
  }
}


