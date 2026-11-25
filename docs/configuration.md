# Configuration

Unofficial plugin. Not affiliated with Specter.

The plugin works without options. Set them on its entry in `opencode.json`; an option the plugin does not know stops it
from loading with `OPTIONS_INVALID`, which names the option, so a typo cannot leave the plugin more open than you meant.

## Options

<!-- generated:configuration -->
| Option | Type | Default | Description |
|---|---|---|---|
| `access` | `all` \| `ask-changes` \| `read-only` | `"all"` | How much the plugin's methods may do: everything, ask before a change or a credit spend, or free reads only. |
| `accounts` | object | — | One profile per account alias. Each alias signs in to Specter's MCP server separately, in /mcps. |
| `allowUntestedHost` | boolean | `false` | Start outside the tested OpenCode range, with a warning in status. |
| `requestTimeoutMs` | integer | `30000` | How long one request to Specter's REST API may take, in milliseconds. |
<!-- /generated:configuration -->

## Examples

Ask before a change or a credit spend:

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/specter-plugin#v0.0.0",
      "options": { "access": "ask-changes", "requestTimeoutMs": 60000 }
    }
  ]
}
```

Two accounts, each signed in separately in `/mcps`:

```json
{
  "plugins": [
    {
      "package": "github:we-the-rebel-alliance/specter-plugin#v0.0.0",
      "options": { "accounts": { "work": {}, "personal": {} } }
    }
  ]
}
```

A profile has no fields: an alias is only a separate MCP sign-in, and `{}` is a complete profile.

Load on an OpenCode release outside the tested range, with a warning in status:

```json
{ "options": { "allowUntestedHost": true } }
```
