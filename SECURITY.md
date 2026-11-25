# Security

## Supported versions

Only the latest release is supported.

## Reporting a vulnerability

Report a vulnerability through GitHub's private vulnerability reporting on this repository. Do not open a public issue with a credential, a team API key or a person's data in it.

## Data handling

### Network access

The plugin's own requests go only to Specter's REST API, `https://app.tryspecter.com/api/v1`. OpenCode itself talks to
Specter's MCP server, one connection per account alias. No request goes anywhere else, and the plugin makes no request at
load time. `docs/security.md` has the full account.

### Credentials

- **The MCP sign-in** is OpenCode's own OAuth credential, per alias. The plugin never sees or stores it.
- **The team API key** is pasted in `/connect` → **Specter team API key** and stored by OpenCode. The plugin reads it at
  call time, keeps it for that call, and sends it only in the `X-API-Key` header to the REST origin: never to another
  origin, never in a URL, and never in an error, a status line, a log line or a result.

### Untrusted content

Specter content is data, never instructions. It is marked `trust: "untrusted"`, is never followed as instruction-shaped
text, and is never echoed into status. The saved-search feed refuses an event whose text holds a secret, with reason
`secret`, and never lists it.

### Fixtures and tests

Every company, search, person and key in the repository is invented. The conformance fixture is redacted and checked with
`plugin-kit record --check`; no real credential or personal data is committed.
