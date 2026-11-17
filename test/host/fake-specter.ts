// A loopback fake of Specter's two hosts: the MCP server at /mcp (Streamable HTTP, JSON responses) with its sign-in
// server, and the REST API under /api/v1, which serves the free credit balance the key check asks. The fetch router
// (route-fetch.ts) sends https://mcp.tryspecter.com and https://app.tryspecter.com here. It records each request's
// method, path, JSON-RPC method and whether an API key or a bearer token was present, never their values.
//
// The sign-in emulates the metadata Specter's MCP server publishes, as recorded from its public, unauthenticated
// well-known documents on 2026-11-17 (the gap report; not yet confirmed by a live sign-in):
// - a 401 from /mcp with `WWW-Authenticate: Bearer scope="openid", resource_metadata="<origin>/.well-known/
//   oauth-protected-resource/mcp"`;
// - protected-resource metadata: resource `<origin>/mcp`, authorization server `<origin>/`, scopes `openid`;
// - authorization-server metadata at `<origin>/.well-known/oauth-authorization-server`: dynamic client registration
//   (`registration_endpoint`), client ID metadata documents (`client_id_metadata_document_supported: true`), PKCE S256,
//   token endpoint auth `none` and `private_key_jwt`, grants `authorization_code` and `refresh_token`, and a revocation
//   endpoint. Specter's Help Center adds the `offline_access` scope.
// The four endpoint paths (/authorize, /token, /register, /revoke) are the fake's own: the record names the fields, not
// these paths. The authorization endpoint plays a signed-in browser that consents at once. The tool list is invented
// and holds no Specter tool name: the real list comes from a live capture.

/** Specter's MCP host, as the plugin and OpenCode address it; the router sends it to this fake. */
export const SPECTER_MCP_ORIGIN = "https://mcp.tryspecter.com"
/** The scope Specter's challenge and metadata name, and the one its Help Center adds. */
export const SCOPES = ["openid", "offline_access"] as const

/** Invented tools, standing in for Specter's until the capture: names no Specter server is known to serve. */
export const FAKE_TOOLS = [
  { name: "fake_read_tool", description: "An invented read", annotations: { readOnlyHint: true }, inputSchema: { type: "object", properties: {} } },
  { name: "fake_other_tool", description: "An invented tool", annotations: {}, inputSchema: { type: "object", properties: {} } },
] as const

/**
 * The credit balance (`GET /api/v1/organization/credits`), free, in the shape of Specter's OpenAPI
 * CreditBalanceV1Response, and Specter's documented 401 bodies. Invented numbers.
 */
export const FAKE_BALANCE = { credit_limit: 1000, used: 10, remaining: 990, unlimited: false, daily_cap: 0, daily_used: 0, daily_remaining: 0 }

interface FakeRequest {
  readonly method: string
  readonly path: string
  readonly rpc?: string
  readonly apiKey: boolean
  readonly bearer: boolean
}

/** What one sign-in sent: how the client was registered, and whether it used PKCE and the documented scope. */
export interface SignIn {
  /** `dcr` when the client registered at /register first; `cimd` when its client_id is an HTTPS metadata URL. */
  readonly registration: "dcr" | "cimd" | "unknown"
  readonly clientId: string
  readonly scope: string
  readonly codeChallengeMethod: string | null
  readonly resource: string | null
}

export interface FakeSpecter {
  readonly origin: string
  readonly requests: FakeRequest[]
  /** While true, an MCP request without a token this fake issued gets 401 with Specter's bearer challenge. */
  challenge: boolean
  /** The team keys the REST API accepts. */
  readonly keys: Set<string>
  /** Each authorization request, in order. */
  readonly signIns: SignIn[]
  /** Each token request's grant type and whether it carried a PKCE verifier, in order. */
  readonly tokens: { readonly grant: string; readonly verifier: boolean; readonly resource: string | null }[]
  /** The metadata documents' paths that were asked for, in order. */
  readonly discovery: string[]
  close(): Promise<void>
}

type Message = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: { protocolVersion?: string; name?: string } }

/** The protected-resource metadata Specter publishes, for a server at `origin`. */
export const protectedResource = (origin: string) => ({ resource: `${origin}/mcp`, authorization_servers: [`${origin}/`], scopes_supported: ["openid"] })

/** The authorization-server metadata Specter publishes, for an issuer at `origin`; the endpoint paths are the fake's. */
export const authorizationServer = (origin: string, options: FakeOptions = {}) => ({
  issuer: `${origin}/`,
  authorization_endpoint: `${origin}/authorize`,
  token_endpoint: `${origin}/token`,
  registration_endpoint: `${origin}/register`,
  revocation_endpoint: `${origin}/revoke`,
  client_id_metadata_document_supported: options.cimd !== false,
  response_types_supported: ["code"],
  grant_types_supported: ["authorization_code", "refresh_token"],
  code_challenge_methods_supported: ["S256"],
  token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
  scopes_supported: [...SCOPES],
})

/** Specter's 401 challenge from /mcp, for a server at `origin`. */
export const challengeHeader = (origin: string) => `Bearer scope="openid", resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp"`

export interface FakeOptions {
  /**
   * Whether the metadata advertises client ID metadata documents, as Specter's does. False leaves dynamic client
   * registration as the only route, to test that one too.
   */
  readonly cimd?: boolean
}

export function startFakeSpecter(options: FakeOptions = {}): FakeSpecter {
  const requests: FakeRequest[] = []
  const signIns: SignIn[] = []
  const tokens: FakeSpecter["tokens"][number][] = []
  const discovery: string[] = []
  const registered = new Set<string>()
  const issued = new Set<string>()
  let codes = 0
  const fake = { challenge: true, keys: new Set<string>() } as FakeSpecter
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) => Response.json(body, { status, headers })

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

  /** The sign-in server: both metadata documents and the four endpoints, at Specter's public origin. */
  const signIn = async (request: Request, url: URL): Promise<Response> => {
    const origin = SPECTER_MCP_ORIGIN
    const route = url.pathname
    if (route.startsWith("/.well-known/")) discovery.push(route)
    if (route === "/.well-known/oauth-protected-resource/mcp" || route === "/.well-known/oauth-protected-resource") return json(200, protectedResource(origin))
    if (route === "/.well-known/oauth-authorization-server" || route === "/.well-known/openid-configuration") return json(200, authorizationServer(origin, options))
    if (route === "/register" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
      const clientId = `fake-client-${registered.size + 1}`
      registered.add(clientId)
      return json(201, { ...body, client_id: clientId, client_id_issued_at: 0, token_endpoint_auth_method: "none" })
    }
    // Like a signed-in browser that consents at once: the authorization endpoint sends the callback a code.
    if (route === "/authorize") {
      const query = url.searchParams
      const clientId = query.get("client_id") ?? ""
      signIns.push({
        registration: registered.has(clientId) ? "dcr" : /^https:\/\//.test(clientId) ? "cimd" : "unknown",
        clientId,
        scope: query.get("scope") ?? "",
        codeChallengeMethod: query.get("code_challenge_method"),
        resource: query.get("resource"),
      })
      const target = new URL(query.get("redirect_uri") ?? "/")
      target.searchParams.set("code", `fake-code-${++codes}`)
      if (query.get("state")) target.searchParams.set("state", query.get("state")!)
      return new Response(null, { status: 302, headers: { location: target.toString() } })
    }
    if (route === "/token" && request.method === "POST") {
      const form = Object.fromEntries(new URLSearchParams(await request.text()))
      tokens.push({ grant: form.grant_type ?? "", verifier: typeof form.code_verifier === "string" && form.code_verifier.length >= 43, resource: form.resource ?? null })
      const token = `fake-access-${tokens.length}`
      issued.add(token)
      return json(200, { access_token: token, token_type: "Bearer", expires_in: 3600, refresh_token: `fake-refresh-${tokens.length}`, scope: SCOPES.join(" ") })
    }
    if (route === "/revoke" && request.method === "POST") return new Response(null, { status: 200 })
    return json(404, { error: "not_found" })
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      const authorization = request.headers.get("authorization") ?? ""
      const base = { method: request.method, path: url.pathname, apiKey: request.headers.has("x-api-key"), bearer: /^Bearer\s/i.test(authorization) }
      if (url.pathname.startsWith("/.well-known/") || ["/register", "/authorize", "/token", "/revoke"].includes(url.pathname)) {
        requests.push(base)
        return signIn(request, url)
      }
      if (url.pathname.startsWith("/mcp")) {
        const body = request.method === "POST" ? ((await request.json().catch(() => undefined)) as Message | Message[] | undefined) : undefined
        const messages = body === undefined ? [] : Array.isArray(body) ? body : [body]
        if (messages.length === 0) requests.push(base)
        for (const message of messages) requests.push({ ...base, rpc: message.method })
        const token = authorization.replace(/^Bearer\s+/i, "")
        if (fake.challenge && !issued.has(token)) return new Response(JSON.stringify({ error: "invalid_token" }), { status: 401, headers: { "content-type": "application/json", "www-authenticate": challengeHeader(SPECTER_MCP_ORIGIN) } })
        if (request.method !== "POST") return new Response(null, { status: 405, headers: { allow: "POST" } })
        const replies = messages.filter((message) => message.id !== undefined && message.id !== null).map(answer)
        if (replies.length === 0) return new Response(null, { status: 202 })
        return Response.json(Array.isArray(body) ? replies : replies[0])
      }
      requests.push(base)
      const requestId = { "x-request-id": crypto.randomUUID() }
      if (url.pathname === "/api/v1/organization/credits" && request.method === "GET") {
        const key = request.headers.get("x-api-key")
        if (!key) return json(401, { errorCode: "API_KEY_MISSING", message: "No API Key was presented on the header X-API-KEY" }, requestId)
        if (!fake.keys.has(key)) return json(401, { errorCode: "API_KEY_NOT_VALID", message: "API key present, but not valid" }, requestId)
        return json(200, FAKE_BALANCE, requestId)
      }
      // The rest of the REST API: nothing else is served yet, because no tool calls it.
      return json(404, { errorCode: "NOT_FOUND", message: "Not Found" }, requestId)
    },
  })

  return Object.assign(fake, {
    origin: `http://127.0.0.1:${server.port}`,
    requests,
    signIns,
    tokens,
    discovery,
    close: () => server.stop(true),
  })
}
