// The standard's 401-final proof for this plugin's actual MCP server config, through the contract's own harness: a 401
// to `server/discover` ends the attempt, and no legacy `initialize` follows. The real 2.4.1 host's own fallback is a
// host/standard discrepancy (see test/host/plugin.test.ts); this test proves the contract behaviour the plugin relies on.
import { describe, expect, test } from "vitest"
import { connectMcpServer } from "@we-the-rebel-alliance/plugin-contract/kit"
import { mcpServerConfig } from "../../src/provider/specter.js"

describe("Specter's MCP server probe", () => {
  test("declares no protocol, so OpenCode probes it with server/discover first", () => {
    const config = mcpServerConfig("specter")
    expect(config).toEqual({ type: "remote", url: "https://mcp.tryspecter.com/mcp" })
    expect("protocol" in config).toBe(false)
  })

  test("a 401 to server/discover ends the attempt with no initialize", async () => {
    const sent: string[] = []
    const transport = {
      request: async (method: string) => {
        sent.push(method)
        return { status: 401 }
      },
    }
    const connection = await connectMcpServer(mcpServerConfig("specter"), transport)
    expect(connection.status).toBe("failed")
    expect(connection.code).toBe(401)
    expect(connection.sent).toEqual(["server/discover"])
    expect(sent).toEqual(["server/discover"])
    expect(sent).not.toContain("initialize")
  })
})
