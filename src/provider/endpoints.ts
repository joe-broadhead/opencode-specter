// Specter's addresses, named once. Nothing outside this folder writes a URL or a header name: the provider client is
// the one place that talks to Specter.
//
// The hosted MCP server is Specter's own (streamable HTTP); its sign-in is per person and is OpenCode's OAuth. The REST
// API is the plugin's own tools and the saved-search feed; the team API key goes only to that origin, under that path,
// in `X-API-Key`.

/** Specter's hosted MCP server. OpenCode keys its OAuth per server name (`specter`, `specter-<alias>`). */
export const MCP_URL = "https://mcp.tryspecter.com/mcp"

/** Specter's REST API base. */
export const REST_BASE = "https://app.tryspecter.com/api/v1"

/** The header the team API key travels in, and the only place it is ever sent. */
export const API_KEY_HEADER = "X-API-Key"

/** Where a person copies the team API key from. */
export const API_CONSOLE_URL = "https://app.tryspecter.com/settings/api-console"

/** Specter's support address, for a report that names a request ID. */
export const SUPPORT_EMAIL = "api-support@tryspecter.com"
