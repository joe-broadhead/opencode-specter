---
name: specter-write
description: Read before any Specter call that spends credits or changes Specter data - enriching a company, a saved search's results, the specter.saved feed, creating or updating a Specter list or adding companies to one. Covers asking first, one change at a time, and reporting what was spent.
---

If Specter's tools are absent, run `/connect` and sign in to Specter (the `specter` server in `/mcps`, and **Specter** for the team API key), or on Jelly call jelly_connection_request.

# Spending credits and changing Specter

Three of the plugin's tools spend the team's credits. Specter's own MCP tools, which are not yet classified, spend them
too once a person's 100 daily calls are used up.

| Tool | What it spends |
| --- | --- |
| `specter_get_company` | 1 credit per result returned; a company Specter does not know costs nothing, because the call fails. |
| `specter_saved_search_results` | 1 credit per result returned, so the page's `limit` is the most it can cost. |
| `specter_events_list` | 1 credit per company Specter returned; its lookback and page overlap re-read a few, so a poll can cost a little more than the events it lists. A page holds at most 25. |

`specter_search_companies` and `specter_list_saved_searches` are free, and so is `specter_probe`.

## Rules

- The `access` option decides whether such a call asks. At the default `all`, nothing asks first, so say in your reply
  what the call does, what it may spend and whom it reaches before you make it. At `ask-changes` it asks; at
  `read-only` it is denied.
- One change at a time. Never repeat a call that may already have spent credits without saying so first: the plugin
  never retries a call that spends.
- Use the free calls first: resolve domains with `specter_search_companies`, find the search id with
  `specter_list_saved_searches`, then read only what is needed.
- Specter publishes no price per credit. Report what a result says it spent, in credits, and say that the price is not
  public rather than converting it to money.
- This plugin never writes to Affinity, and you should not copy Specter data into Affinity by another route unasked:
  Specter documents its own sync to Affinity, and two writers on the same fields is the failure to avoid.
