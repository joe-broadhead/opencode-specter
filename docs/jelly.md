# In Jelly

[Jelly](https://heyjelly.ai) runs OpenCode agents. It reads the `jelly` section of this package's `package.json` as
JSON, without loading the plugin, when a person reviews the exact version, and uses it as follows.

Jelly names the plugin **Specter** (`jelly.title`), with the package name and version beneath, the one line in
`jelly.summary`, and the mark in `jelly.icon` (`assets/icon.svg`, shipped in the package). The mark is the family's own
tile, not Specter's logo.

## Tools and permissions

6 tools are declared (4 read-only): the plugin's own four on Specter's REST API, and the source contract's
`events_list` and `probe`. The four reads — finding a company's ID, listing saved searches, and the source's two
methods — never change anything; `get_company` and `saved_search_results` spend Specter credits, so they are not
read-only and follow the access choice as changes. Specter's own MCP tools are not declared until a live capture
classifies them; a tool that is not declared still follows the access choice, as the block below says.
`test/unit/jelly.test.ts` keeps `jelly.tools` in step with the tool tables, and checks each declared effect against the
plugin's own default rules.

The family's shared rules, word for word from Jelly's guide:

<!-- family-block:start -->
- At Allowed (`all`), the default, every tool runs without asking, declared or not, whatever its `effect`.
- At Ask before changes (`ask-changes`), a `readOnly` tool runs, and every other tool asks first, including a tool this plugin does not declare.
- At Read only (`read-only`), a `readOnly` tool runs, and every other tool is off, including a tool this plugin does not declare.
- A declared `effect` of `allow` changes nothing: the tool follows the access choice and its `readOnly`.
- A declared `effect` of `ask` makes the tool ask at Ask before changes, even when it is `readOnly`, and changes nothing at Allowed or Read only.
- A declared `effect` of `deny` turns the tool off at Ask before changes and at Read only, and changes nothing at Allowed.
- An action listed in `asks` asks first at Ask before changes and at Read only, and never at Allowed.
- A tool named with one `*`, such as another account's `plaud-*.get_file`, follows the same rules as a tool named in full.
- A choice the person makes for one tool wins over the access choice and the declared `effect`.
- jelly leaves out a key it does not know at the top level of the `jelly` block, and reads the rest.
- jelly refuses the plugin for a key it does not know inside anything it reads, such as a tool, a sign-in or a setting.
- jelly refuses the plugin, with one plain line, when `requires` names a field or a feature it does not read.
<!-- family-block:end -->

A tool that spends Specter credits will be declared without `readOnly`, so it asks at Ask before changes and is off at
Read only, as a change is.

## Skills

Declared: `specter` and `specter-write`.

## Views and scripts

None: `jelly.views` and `jelly.rpc` are empty.

## Cost

`jelly.cost`, shown on the review before the plugin installs: Specter bills in credits from the team's one pool and
publishes no price per credit; each person gets 100 MCP tool calls a day, and past that a call spends team credits only
if a Specter admin allows it; calls with the team key spend credits per result, and checking the key is free. The facts
and their sources are in [What Specter calls cost](costs.md). `jelly.admin` is not declared: Specter's sign-in needs no
admin step first, as far as its public docs show.

## Signing in

`jelly.signIns` declares two separate sign-ins, not one group, because Jelly reads a group's sign-ins as alternatives,
one connected being enough, and these two are not: Specter's MCP tokens and its API keys are not interchangeable.

- `account`, for Specter's hosted MCP server `specter`, which OpenCode signs in with OAuth, per person. Required.
- `specter`, the plugin's own key integration: the team's Specter API key, pasted once. Not required (`required:
  false`) until one of the plugin's own tools needs it. Its `help` links to Specter's
  [API Console](https://app.tryspecter.com/settings/api-console), and its `needed` codes, `AUTH_REQUIRED` (no key
  connected) and `KEY_REJECTED` (Specter refused the key), ask the person to connect it.

Not yet checked: whether Jelly's sign-in screen draws a `key` method for a plugin's own integration. It is checked by
hand before the first release.

## Settings

`jelly.contributes.settings` declares two of the plugin's options:

- `access`, a choice of three: **Allowed** (`all`, the default), **Ask before changes** (`ask-changes`) and **Read
  only** (`read-only`), with Jelly's own line for each.
- `requestTimeoutMs`, a whole number of milliseconds with its bounds and default, which are a proposal (see the
  configuration guide).

## Versions

Jelly's curated catalogue pins an exact version. The declaration test runs the shared kit, `test/support/jelly-kit.ts`,
and Jelly's setting rules, `test/support/jelly-settings.ts`; `scripts/check-copies.mjs` keeps both equal to the copies
every plugin carries.
