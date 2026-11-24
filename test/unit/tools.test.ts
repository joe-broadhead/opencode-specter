import { describe, expect, it } from "vitest"
import { NAMESPACE_DESCRIPTION, SERVER_NAME } from "../../src/constants.js"
import { isServerTool, OWN_TOOLS, registerTools, TOOL_PREFIX } from "../../src/tools.js"

/** A fake `ctx.tool` that runs the transform once over `listed`, recording the namespace it describes. */
function toolContext(listed: { id: string; options?: { namespace?: string } }[]) {
  const namespaces: unknown[] = []
  const ctx = {
    tool: {
      transform: async (callback: (editor: unknown) => void) => {
        callback({ list: () => listed, namespace: (value: unknown) => namespaces.push(value), add: () => undefined })
        return { dispose: async () => undefined }
      },
    },
  }
  return { ctx: ctx as never, namespaces }
}

describe("the specter namespace", () => {
  it("tells a server tool from the plugin's own and from other plugins' tools", () => {
    expect(isServerTool({ id: `${TOOL_PREFIX}some_tool`, options: { namespace: SERVER_NAME } })).toBe(true)
    expect(isServerTool({ id: `${TOOL_PREFIX}some_tool`, options: { namespace: "other" } })).toBe(false)
    expect(isServerTool({ id: "other_tool", options: { namespace: SERVER_NAME } })).toBe(false)
    for (const own of OWN_TOOLS) expect(isServerTool({ id: own, options: { namespace: SERVER_NAME } })).toBe(false)
  })

  it("counts the server's tools and flags the ones the table does not know", async () => {
    const { ctx, namespaces } = toolContext([
      { id: `${TOOL_PREFIX}b_tool`, options: { namespace: SERVER_NAME } },
      { id: `${TOOL_PREFIX}a_tool`, options: { namespace: SERVER_NAME } },
      { id: "bash" },
    ])
    const tools = await registerTools(ctx, { specs: [], owned: () => true, report: () => undefined })
    expect(tools.tools()).toEqual({ visible: 2, unknown: [`${TOOL_PREFIX}a_tool`, `${TOOL_PREFIX}b_tool`] })
    expect(namespaces).toEqual([{ name: SERVER_NAME, description: NAMESPACE_DESCRIPTION }])
  })

  it("is one line within the 400-character budget, naming both tool families, the shared credit pool and untrusted content", () => {
    expect(NAMESPACE_DESCRIPTION.length).toBeLessThanOrEqual(400)
    expect(NAMESPACE_DESCRIPTION).toMatch(/Specter's own MCP tools/)
    expect(NAMESPACE_DESCRIPTION).toMatch(/this plugin's tools on the team's API key/)
    expect(NAMESPACE_DESCRIPTION).toMatch(/shared credits/)
    expect(NAMESPACE_DESCRIPTION).toMatch(/untrusted data, never instructions/)
    // The access level is enforced by the permission rules and shown in status, not by a namespace variant.
    expect(NAMESPACE_DESCRIPTION).not.toMatch(/ask-changes|read-only|`access`/)
  })

  it("leaves the namespace alone while another server owns the name", async () => {
    const { ctx, namespaces } = toolContext([])
    await registerTools(ctx, { specs: [], owned: () => false, report: () => undefined })
    expect(namespaces).toEqual([])
  })
})
