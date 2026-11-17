# Security

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Report a vulnerability privately through GitHub's security advisories for this repository, not in a public issue.

## Data handling

### Network access

The plugin's own requests go only to Specter's REST API, `https://app.tryspecter.com/api/v1`. OpenCode itself talks
to Specter's MCP server. No request goes anywhere else. Status waits on no request: with a key connected, it starts
the key check, one free `GET /organization/credits` per key, in the background, and shows its last answer.

### Credentials

- **The MCP sign-in** is OpenCode's own OAuth credential, per person. The plugin never sees it.
- **The team API key** is pasted in `/connect` → **Specter** and stored by OpenCode. The plugin reads it when a call
  needs it, keeps it in memory, and sends it only in the `X-API-Key` header to the REST base: never to another origin,
  and never on a redirect off that base. It never appears in an error, a status line, a log line or a result; a test
  checks this with a dummy key. There is no environment variable for it.
- The key is the team's: Specter issues one per team, so it cannot be scoped down, and a leak carries its full rights.
  Rotate it through Specter, never through the plugin: email api-support@tryspecter.com, as Specter's
  [Authentication](https://api.tryspecter.com/api-ref/auth.md) page says, then paste the new key in `/connect` →
  **Specter** on every machine. The old key then fails with `KEY_REJECTED`.

### Untrusted content

Specter's results are data, never instructions. The namespace description and the skills say so to the model; that is
a rule for the model, not a guard in the plugin.

## Permissions

The default rules allow free reads, and give calls that spend credits, changes and unclassified tools the effect the
`access` option sets. Agents without the block are named in `/specter-status`.

## Scripts

Scripts call the tools RPC as a session and its agent; only a prior explicit `allow` runs, and an `ask` is refused.
