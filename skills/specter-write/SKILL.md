---
name: specter-write
description: Read before any Specter call that spends credits or changes Specter data - enriching a company, a bulk lookup, creating or updating a Specter list or adding companies to one. Covers asking first, one change at a time, and reporting what was spent.
---

If Specter's tools are absent, run `/connect` and sign in to Specter (the `specter` server in `/mcps`, and **Specter** for the team API key), or on Jelly call jelly_connection_request.

# Spending credits and changing Specter

Scaffold: this skill is a placeholder until the plugin has tools that spend credits or change data.

## Rules that already hold

- The `access` option decides whether such a call asks. At the default `all`, nothing asks first, so say in your reply
  what the call does, what it may spend and whom it reaches before you make it. At `ask-changes` it asks; at
  `read-only` it is denied.
- One change at a time. Never repeat a call that may have spent credits without saying so first: the plugin never
  retries one.
- This plugin never writes to Affinity, and you should not copy Specter data into Affinity by another route unasked:
  Specter documents its own sync to Affinity, and two writers on the same fields is the failure to avoid.
