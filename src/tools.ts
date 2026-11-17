// The `specter` namespace and its two tool families: Specter's own MCP tools (`specter_<server tool>`, signed in per
// person) and the plugin's own tools (`OWN_TOOLS`, on the team key), under one prefix, as opencode-github keeps
// GitHub's tools and github_api. The transform describes the namespace for Code Mode, registers the plugin's own tools
// from their specs, and counts the server's tools, recording the ones the table does not know. Synchronous; it never
// throws, and a failure is kept for status.
import type { Plugin } from "@opencode/plugin"
import { type Access, errorText, NAMESPACE_DESCRIPTION, SERVER_NAME } from "./constants.js"
import { reasonOf } from "./redact.js"
import { READ_TOOL_CLASSES } from "./read-tools.js"
import { SOURCE_TOOL_CLASSES } from "./source/index.js"
import { mcpToolClass, type ToolClass } from "./specter-tools.js"
import { buildTool, type ToolSpec } from "./tool-spec.js"

/** MCP tool names are `<server>_<tool>`; this is the prefix for the specter server, and for the plugin's own tools. */
export const TOOL_PREFIX = `${SERVER_NAME}_`

/** Every tool the plugin registers itself: its REST tools and the source contract's two methods, never Specter's. */
export const OWN_TOOL_CLASSES: Readonly<Record<string, ToolClass>> = { ...READ_TOOL_CLASSES, ...SOURCE_TOOL_CLASSES }

/** The plugin's own tools: never Specter's server tools, so the count neither includes nor flags them. */
export const OWN_TOOLS: ReadonlySet<string> = new Set(Object.keys(OWN_TOOL_CLASSES).map((name) => `${TOOL_PREFIX}${name}`))

/** The host gives each MCP tool its server name as the Code Mode namespace. */
export function isServerTool(tool: { readonly id: string; readonly options?: { readonly namespace?: string } }): boolean {
  return tool.id.startsWith(TOOL_PREFIX) && !OWN_TOOLS.has(tool.id) && tool.options?.namespace === SERVER_NAME
}

/** The specter server's tools that agents can use, and the ones the table does not know. */
export type ServerTools = { readonly visible: number; readonly unknown: readonly string[] }

type ToolContext = { readonly tool: Pick<Plugin.Context["tool"], "transform"> }

export async function registerTools(
  ctx: ToolContext,
  input: {
    readonly access: Access
    readonly specs: readonly ToolSpec[]
    /** False while the `specter` name belongs to a server at another URL: its namespace is left as it is. */
    readonly owned: () => boolean
    readonly report: (problem: string | undefined) => void
  },
): Promise<{ dispose(): Promise<void>; tools(): ServerTools }> {
  let tools: ServerTools = { visible: 0, unknown: [] }
  const specs = input.specs
  const registration = await ctx.tool.transform((editor) => {
    try {
      if (input.owned()) editor.namespace({ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION[input.access] })
      for (const spec of specs) editor.add(buildTool(spec) as never)
      const unknown: string[] = []
      let visible = 0
      for (const tool of editor.list()) {
        if (!isServerTool(tool)) continue
        visible++
        if (mcpToolClass(tool.id.slice(TOOL_PREFIX.length)) === undefined) unknown.push(tool.id)
      }
      tools = { visible, unknown: unknown.sort() }
      input.report(undefined)
    } catch (error) {
      input.report(errorText("SERVER_NOT_REGISTERED", `The ${SERVER_NAME} tools could not be registered (${reasonOf(error)}).`, "Restart OpenCode."))
    }
  })
  return { dispose: registration.dispose, tools: () => tools }
}
