// A loopback fake of Specter's two hosts: the MCP server at /mcp (Streamable HTTP, JSON responses) and the REST API
// under /api/v1. It records each request's method, path, JSON-RPC method and whether an API key or a bearer token was
// present, never their values.
//
// The MCP server asks for a sign-in by default, with a bearer challenge, as a server does before one. It serves no
// sign-in itself: Specter's OAuth flow is unknown (B2). TODO(Slice 4): emulate the flow B2 records (protected-resource
// metadata, an authorization server and, if Specter has it, dynamic client registration), as opencode-linear's
// fake-mcp.ts does, so a host test can complete the sign-in. The tool list is invented and holds no Specter tool name:
// the real list comes from Slice 3's capture.

/** Invented tools, standing in for Specter's until the capture: names no Specter server is known to serve. */
export const FAKE_TOOLS = [
  { name: "fake_read_tool", description: "An invented read", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: {} } },
  { name: "fake_other_tool", description: "An invented tool", annotations: {}, inputSchema: { type: "object", properties: {} } },
] as const

interface FakeRequest {
  readonly method: string
  readonly path: string
  readonly rpc?: string
  readonly apiKey: boolean
  readonly bearer: boolean
}

export interface FakeSpecter {
  readonly origin: string
  readonly requests: FakeRequest[]
  /** While true, every MCP request gets 401 with a bearer challenge. */
  challenge: boolean
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: { protocolVersion?: string; name?: string } }

export function startFakeSpecter(): FakeSpecter {
  const requests: FakeRequest[] = []
  const fake = { challenge: true } as FakeSpecter

  const answer = (message: Message) => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result })
    switch (message.method) {
      case "initialize":
        return reply({ protocolVersion: message.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fake-specter", version: "0.0.0" } })
      case "tools/list":
        return reply({ tools: FAKE_TOOLS })
      case "tools/call":
        return reply({ content: [{ type: "text", text: `called ${message.params?.name ?? ""}` }] })
      case "ping":
        return reply({})
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } }
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const base = { method: request.method, path: url.pathname, apiKey: request.headers.has("x-api-key"), bearer: /^Bearer\s/i.test(request.headers.get("authorization") ?? "") }
      if (url.pathname.startsWith("/mcp")) {
        const body = request.method === "POST" ? ((await request.json().catch(() => undefined)) as Message | Message[] | undefined) : undefined
        const messages = body === undefined ? [] : Array.isArray(body) ? body : [body]
        if (messages.length === 0) requests.push(base)
        for (const message of messages) requests.push({ ...base, rpc: message.method })
        if (fake.challenge) return new Response("unauthorized", { status: 401, headers: { "www-authenticate": 'Bearer error="invalid_request"' } })
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } })
        const replies = messages.filter((message) => message.id !== undefined && message.id !== null).map(answer)
        if (replies.length === 0) return new Response(null, { status: 202 })
        return Response.json(Array.isArray(body) ? replies : replies[0])
      }
      requests.push(base)
      // The REST API: nothing is served yet, because no tool calls it (Slice 7).
      return Response.json({ message: "Not Found" }, { status: 404 })
    },
  })

  return Object.assign(fake, {
    origin: `http://127.0.0.1:${server.port}`,
    requests,
    close: () => server.stop(true),
  })
}
