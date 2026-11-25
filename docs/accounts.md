# Accounts

Unofficial plugin. Not affiliated with Specter.

Specter signs in twice, and the two are deliberately separate:

- **Each account alias is Specter's own MCP server.** The manifest's account mechanism is `mcp`, so OpenCode holds one
  OAuth sign-in per alias, and Specter's MCP tools are passed through per alias. A person's sign-in is theirs alone.
- **The team API key is not an account.** The plugin's own tools and the `specter.saved` feed use one team key for the
  whole team; it is a separate integration, `specter-team`, and its methods are `accounts: none`. It never stands in for
  a person's account, and its probe names the key's fingerprint rather than a person.

## Mechanism

<!-- generated:accounts -->
Accounts are held by the **mcp** mechanism: the vendor's MCP server holds them.

The profile has no fields.
<!-- /generated:accounts -->

## Sign in per alias

Add one entry to `options.accounts` per alias. Each alias becomes a server named `<plugin>` for `default` and
`<plugin>-<alias>` otherwise:

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

Then sign in to each server in `/mcps`:

| Alias | Server in `/mcps` |
| --- | --- |
| `default` (no `accounts` option) | `specter` |
| `work` | `specter-work` |
| `personal` | `specter-personal` |

The team key is separate: in `/connect`, choose **Specter team API key** and paste the team's key from Specter's API
Console. One key serves every alias's own tools; the key does not change with `account`.

## Picking an account in a call

`events_list` and `probe` take `account`. With one alias it may be left out; with more than one, leaving it out is
`ACCOUNT_REQUIRED`, whose next step lists the aliases, and an alias the plugin does not have is `ACCOUNT_UNKNOWN`.

```js
// tools.specter.events_list in Code Mode, with the work alias.
tools.specter.events_list({ account: "work", scope: { search: "5432" } })
```

A page and its cursor belong to one account: a cursor issued for `work` read under `personal` is `CURSOR_INVALID`, never
a silent restart. The four own REST tools (`search_companies`, `get_company`, `list_saved_searches`,
`saved_search_results`) take no `account`; they use the team key and report `default` as their internal account.
`events_list` and `probe` take the alias, because a page and a probe answer for one alias even though the data behind
them is the team's.

## Team key limits

The key is the team's. Everyone who uses it spends from one credit pool and one rate limit, and Specter cannot tell who
made a call. It is sent only to Specter's REST API, in the `X-API-Key` header, and never appears in a status line, a log
line or a result.
