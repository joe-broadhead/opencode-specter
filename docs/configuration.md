# Configuration

Unofficial plugin. Not affiliated with Specter.

The plugin works without options. There is no release tag yet, so this is the options shape, not an install line. Set them on its entry in `opencode.json`:

```json
{
  "plugins": [
    { "package": "github:joe-broadhead/opencode-specter", "options": { "access": "ask-changes", "requestTimeoutMs": 60000 } }
  ]
}
```

Options are strict: an option the plugin does not know stops it from loading with `OPTIONS_INVALID`, which names the
option, so a typo cannot leave the plugin more open than you meant.

## Options

| Option | Type | Default | What it does |
| --- | --- | --- | --- |
| `access` | `"all"`, `"ask-changes"` or `"read-only"` | `"all"` | What the default rules allow. See [Permissions](#permissions). |
| `requestTimeoutMs` | integer, 5000 to 120000 | `30000` | The time limit for one request to Specter's REST API, in milliseconds. A read that times out is retried; a call that may spend credits is not. |
| `allowUntestedHost` | boolean | `false` | Load on an OpenCode release outside `>=2.2.3 <2.4.0`, with a warning in status. |

**`requestTimeoutMs` is a proposal.** Its shape (an integer with bounds) follows the family's `executionTimeoutMs` in
opencode-tavily, but the numbers, a 30-second default between 5 seconds and 2 minutes, are not a Specter fact: they
await sign-off, and may change once real calls are measured. The `jelly` declaration carries the same three numbers.

The time limit applies to the plugin's own REST requests only. Specter's MCP server runs with OpenCode's own defaults.

## Permissions

The `access` option generates a block of default rules from three tool classes. The block goes right after each
agent's base `* * allow` rule:

1. `specter_*` with the change effect, so a tool the plugin has not classified is treated like a change;
2. each `read` tool, allowed;
3. each `spend` and each `write` tool, with the change effect.

The change effect is `allow` at `all`, `ask` at `ask-changes` and `deny` at `read-only`. The last matching rule wins,
so your own rules after the block, an agent's stricter rules and saved approvals still win.

An agent defined only in your config gets no block, because OpenCode creates it after plugins run. `/specter-status`
names it and shows the block: put the block first in that agent's own `permissions`, followed by your top-level rules
for Specter's tools.

## Errors

Every code the plugin's own code raises, with when it happens. Each message ends with its next step.

| Code | When |
| --- | --- |
| `HOST_UNTESTED` | OpenCode is outside `>=2.2.3 <2.4.0` and `allowUntestedHost` is not set. |
| `OPTIONS_INVALID` | An option is unknown or has a wrong value. |
| `SKILLS_INVALID` | A skill file the plugin ships is missing or malformed. |
| `RULES_NOT_ADDED` | The agent transform failed, so the default rules are missing. |
| `SERVER_NOT_REGISTERED` | The MCP transform or the tool transform failed. |
| `INTEGRATION_NOT_REGISTERED` | The key integration's transform failed. |
| `KEY_UNAVAILABLE` | OpenCode could not read the key; the plugin keeps the last key it read. |
| `NOT_RELEASED` | A source install tried to call Specter, so nothing was sent. |
| `STATUS_UNAVAILABLE` | OpenCode did not report the server's state. |
| `AUTH_REQUIRED` | A tool needs the team key and none is connected. |
| `INPUT_INVALID` | A tool's input does not fit its schema. |
| `API_PATH_INVALID` | A request path is not relative, has a `.` or `..` segment, or percent-encodes a plain character. |
| `API_UNREACHABLE` | Specter's REST API could not be reached. |
| `API_TIMEOUT` | One request took longer than `requestTimeoutMs`. |
| `API_REDIRECTED` | Specter redirected a change; a change never follows a redirect. |
| `API_REDIRECT_LOOP` | Specter redirected more than 5 times. |
| `API_REDIRECT_INSECURE` | Specter redirected to a non-HTTPS address. |
| `API_REDIRECT_OFF_HOST` | Specter redirected a read outside its REST API; the key is never sent there. |
| `KEY_REJECTED` | Specter answered 401, or a 403 whose `errorCode` refuses the key itself (such as `api_access_not_granted`). |
| `OUT_OF_CREDITS` | Specter answered 402 with `OUT_OF_CREDITS` (or a 402 without the daily code): the period's credit budget is spent. |
| `DAILY_CREDIT_CAP_REACHED` | Specter answered 402 with `DAILY_CREDIT_CAP_REACHED`; the next step gives `X-CreditLimit-Daily-Reset`'s wait when Specter sends it. |
| `UPSTREAM_ERROR` | Specter answered with another error status: 403 `NOT_PERMITTED` (the plan does not include the endpoint), 404, 422 (including `NEW_RESULTS_AFTER_BEYOND_RETENTION`, a saved-search cutoff older than 60 days), 429 or 5xx. The message names Specter's `errorCode` and `X-Request-ID`, never Specter's own message, which stays in the result's untrusted data. |

These meanings come from Specter's public [Errors](https://api.tryspecter.com/api-ref/errors.md) and
[Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) pages and are not yet confirmed
against live responses.
