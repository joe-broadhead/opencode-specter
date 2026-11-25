# Security

## What leaves the machine

| Destination | What it carries | Who holds the credential |
| --- | --- | --- |
| Specter's REST API, `https://app.tryspecter.com/api/v1` | The plugin's own tool calls and the saved-search feed, with the team API key in `X-API-Key`. | The team key, pasted in `/connect` and stored by OpenCode. |
| Specter's MCP server, `https://mcp.tryspecter.com/mcp` | OpenCode's own MCP traffic, one connection per account alias. | OpenCode's OAuth credential, per person; the plugin never sees it. |

Nothing else. The plugin has no telemetry, no webhook and no other endpoint, and its addresses are named once in
`src/provider/endpoints.ts`.

## Credentials

- **The MCP sign-in** is OpenCode's OAuth credential, per alias. The plugin registers the server and never reads the
  token: it calls `ctx.mcp.list` only for status, which reports OpenCode's state.
- **The team key** is a `key` method on the `specter-team` integration. The plugin reads it at call time and keeps it in
  memory for that call; it is sent only to the REST origin, under the REST path, in the `X-API-Key` header.
- No key, token or URL query string reaches an error, a status line, a log line or a result. A response that echoes the
  key back has it cut out by value before it is parsed; status reasons are redacted and cut to one line.
- The key cannot be scoped down: it is the team's, and Specter does not say which member made a call. Treat it as the
  blast radius, and give it only to teams whose data every user of that key may read.

## Scopes

Specter's MCP OAuth is its own; OpenCode shows and stores it per alias. The REST key has no scopes: Specter's plan decides
which endpoints it may reach, and a `403 NOT_PERMITTED` says the plan excludes one. The plugin requests no other scope.

## Data

- Specter content is **untrusted data**: company names and profiles are never followed as instructions and never choose
  the next tool or recipient.
- The saved-search source lists metadata only (company id and name); its page is marked `trust: "untrusted"`, and an
  event whose text holds a secret is refused for good with reason `secret`.
- Nothing is cached. The plugin stores no response, no cursor and no credential; the consumer keeps its own cursor bound
  to plugin, source, account and scope.
- Fixtures and tests are invented: no real company, person, key or token is committed. The conformance fixture is
  redacted with `plugin-kit record --check` in CI.

## Writes and grants

The plugin writes nothing to Specter. It declares no actions and no plan/commit pair, so no action grant is needed. The
plugin's own methods are reads; Specter's pass-through MCP tools are the vendor's and declared `write` (changes), and the
plugin makes no provider write itself. The two own methods that may spend credits, and the feed, either ask before
running or are refused, as `docs/capabilities.md` describes.

## Reporting a vulnerability

Report it privately through GitHub's security advisories for this repository, not in a public issue.
