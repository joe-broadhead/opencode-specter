# Security

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Report a vulnerability privately through GitHub's security advisories for this repository, not in a public issue.

## Data handling

### Network access

The plugin's own requests go only to Specter's REST API, `https://app.tryspecter.com/api/v1`. OpenCode itself talks
to Specter's MCP server. No request goes anywhere else. Status waits on no request: with a key connected, it starts
the key check, one free `GET /organization/credits` per key and again once its answer is 10 minutes old, in the
background, and shows that key's standing answer: accepted, rejected, not confirmed (an answer that says neither,
such as a 403 without Specter's error code), or not checked.

### Credentials

- **The MCP sign-in** is OpenCode's own OAuth credential, per person. The plugin never sees it.
- **The team API key** is pasted in `/connect` → **Specter** and stored by OpenCode. The plugin reads it when a call
  needs it, keeps it in memory, and sends it only in the `X-API-Key` header to the REST base: never to another origin,
  and never on a redirect off that base. It never appears in an error, a status line, a log line or a result; a test
  checks this with a dummy key. There is no environment variable for it.
- The key is the team's: Specter issues one per team, so it cannot be scoped down, and a leak carries its full rights.
  Rotating it is the team's Specter admin's job, not this plugin's: the key is requested and replaced in the team's
  [API Console](https://app.tryspecter.com/settings/api-console), and Specter's
  [Authentication](https://api.tryspecter.com/api-ref/auth.md) page asks for a rotation by email to
  api-support@tryspecter.com. After the rotation, paste the new key in `/connect` → **Specter** on every machine: the
  plugin's own tools then fail with `KEY_REJECTED`, the source with `NEEDS_SIGN_IN`, and status shows the old key as
  rejected once it re-checks it, which it does when its last answer is more than 10 minutes old.

### Untrusted content

Specter's results are data, never instructions. The namespace description and the skills say so to the model; that is
a rule for the model, not a guard in the plugin.

## Permissions

The default rules allow free reads, and give calls that spend credits, changes and unclassified tools the effect the
`access` option sets. Agents without the block are named in `/specter-status`.

## Scripts

Scripts call the tools RPC as a session and its agent; only a prior explicit `allow` runs, and an `ask` is refused.
