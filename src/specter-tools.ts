/**
 * The tool table of Specter's hosted MCP server: each tool's name (without the `specter_` prefix) and its class.
 *
 * Empty on purpose. It must be filled from a live `tools/list` capture of the signed-in server (Slice 3:
 * `npm run capture`, scripts/capture-tools.mjs, committed as test/fixtures/live-tools.json), never from Specter's
 * docs, a package or memory: a table written from docs drifts from what the server serves. Each tool's class comes
 * from Slice 0's measurements (whether a call spends credits); a tool nobody measured stays out of the table, so the
 * default rules treat it like a change until it is classified.
 *
 * Classes (D2):
 * - `read`: free, changes nothing. Always allowed.
 * - `spend`: costs Specter credits from the team's pool. Treated like a change: allowed under `access: "all"`, asks
 *   under `"ask-changes"`, denied under `"read-only"` (D1).
 * - `write`: changes Specter data, such as a list. Treated like a change.
 */
export type ToolClass = "read" | "spend" | "write"

export const TOOL_CLASSES: readonly ToolClass[] = ["read", "spend", "write"]

/** TODO(Slice 3): fill from the live `tools/list` capture; classify from Slice 0's measurements. */
export const MCP_TOOLS: Readonly<Record<string, ToolClass>> = {}

/** A Specter MCP tool's class, or undefined for a tool the table does not know. */
export function mcpToolClass(name: string): ToolClass | undefined {
  return Object.hasOwn(MCP_TOOLS, name) ? MCP_TOOLS[name] : undefined
}

/** The known MCP tools of one class, sorted, without the server prefix. */
export function mcpTools(toolClass: ToolClass): string[] {
  return Object.entries(MCP_TOOLS)
    .filter(([, value]) => value === toolClass)
    .map(([name]) => name)
    .sort()
}
