/**
 * Specter's part of the tools RPC (`specter.deals.tools`): the plugin value and the method table that the source
 * contract's `tools-rpc` module takes. The module (`@we-the-rebel-alliance/source-contract/tools-rpc`, tag v0.3.0,
 * bundled into `dist/index.js`) is the transport every plugin of the family shares:
 *
 *   POST /api/rpc/specter.deals.tools/<method>
 *   { "input": { "sessionID": "<session>", "input": <the tool's input> } }
 *
 * A script runs as a session and the agent it names; the rule for the method's permission action is resolved before
 * dispatch, and only `allow` runs. An MCP method runs through OpenCode's own executor with OpenCode's own sign-in; a
 * plugin method runs the same spec as the model's tool (tool-spec.ts), and a source method asserts its action and the
 * provider operation it reads (source/).
 *
 * The MCP table is empty until a live capture classifies Specter's tools; the plugin's own four REST tools and the
 * source's `events_list` and `probe` are here now.
 */
import type { Failure, McpResult, MethodSpec, NextSteps, ShapeCall, ToolsRpcPlugin } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { toolsRpcId } from "@we-the-rebel-alliance/source-contract/tools-rpc"
import { DISPLAY_NAME, PLUGIN_ID, SERVER_NAME } from "./constants.js"
import { SpecterPluginError } from "./errors.js"
import { STATUS_COMMAND } from "./rpc.js"
import { MCP_TOOLS } from "./specter-tools.js"
import { methodClass, scriptMethod, type ToolSpec } from "./tool-spec.js"
import { OWN_TOOL_CLASSES } from "./tools.js"

/** The RPC's id: the plugin's id and `.tools`. Scripts call it by name, so it never changes. */
export const TOOLS_RPC_ID = toolsRpcId(PLUGIN_ID)

/**
 * The methods a script can call: every Specter MCP tool the plugin has classified, the plugin's own REST tools, and
 * the source contract's `events_list` and `probe`. The tables come from `specter-tools.ts`, `read-tools.ts` and
 * `source/`, so `describe` cannot drift from what is registered.
 */
export function methodTable(specs: readonly ToolSpec[], source: readonly MethodSpec[]): MethodSpec[] {
  return [
    ...Object.entries(MCP_TOOLS)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, toolClass]): MethodSpec => ({ kind: "mcp", name, class: methodClass(toolClass) })),
    ...specs.map(scriptMethod),
    ...source,
  ]
}

/** Every method's name, sorted: the tools-RPC surface without building the specs, for a check that keeps it honest. */
export function methodNames(): string[] {
  return [...Object.keys(MCP_TOOLS), ...Object.keys(OWN_TOOL_CLASSES)].sort()
}

/** What the model path's `execute.before` hooks do to an MCP call's arguments. Specter has none. */
export function shapeInput(_method: string, input: unknown, _call: ShapeCall): unknown {
  return input
}

/**
 * What the model path's `execute.after` hooks do to a result. None: src/api/specter-error.ts maps the REST API's error
 * object, but how Specter's MCP server reports a failure in a tool result is not yet captured, so nothing here maps it.
 */
export function shapeResult(_method: string, result: McpResult, _call: ShapeCall): McpResult {
  return result
}

/** The next step for each code. Each is one sentence that ends with a full stop. */
export const NEXT_STEPS: NextSteps = {
  SESSION_UNKNOWN: `Create a session in the location you mean, such as POST /api/session with {"agent":"build"} sent with the header "x-opencode-directory: <dir>" or the location[directory] query, and pass its id.`,
  SESSION_AGENT_REQUIRED: `Create a session that names an agent this project has, with its project as the location, such as POST /api/session with {"agent":"build","location":{"directory":"/path/to/project"}}, and pass its id.`,
  PERMISSION_DENIED: "Add an allow rule for the tool to the session's agent or to the session, or use a session whose agent allows it.",
  SERVER_CONFLICT: `Point the MCP server named ${SERVER_NAME} that your config or another plugin defines at ${DISPLAY_NAME}'s address, or remove it, so that this plugin manages ${DISPLAY_NAME}'s server.`,
  AUTH_REQUIRED: `Open /mcps, choose ${SERVER_NAME} and sign in.`,
  CONNECTING: "Wait a few seconds, then call the method again.",
  CONNECTION_FAILED: `Run /${STATUS_COMMAND} and follow its next step.`,
  DISABLED: `Turn the ${SERVER_NAME} server back on in /mcps.`,
  NOT_REGISTERED: `Run /${STATUS_COMMAND} and follow its next step.`,
  TOOL_UNAVAILABLE: `Run /${STATUS_COMMAND}: ${DISPLAY_NAME}'s server does not list this tool now.`,
  UPSTREAM_ERROR: `Check the input against the method's schema from describe, and run /${STATUS_COMMAND} if it keeps failing.`,
  CANCELLED: "Call the method again if you still need the result.",
}

/** The plugin's own errors, thrown by a plugin method's spec, as a code, what happened and the next step. */
export function pluginError(error: unknown): Failure | undefined {
  return error instanceof SpecterPluginError ? { code: error.code, what: error.detail.replace(/\.$/, ""), next: error.nextStep } : undefined
}

export const PLUGIN: ToolsRpcPlugin = { id: PLUGIN_ID, nextSteps: NEXT_STEPS, shapeInput, shapeResult, pluginError }
