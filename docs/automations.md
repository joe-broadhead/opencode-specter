# Automations

Unofficial plugin. Not affiliated with Specter.

An OpenCode automation can poll `specter.saved` with no model in the loop and keep its own cursor in the automation's
state. That is what the source is for: a collector reads new companies after a cursor, one saved search at a time.

The table is generated from the manifest.

<!-- generated:automations -->
| Source | Method | Provider floor | Suggested | Signals |
|---|---|---|---|---|
| `specter.saved` | `tools.specter.events_list` | — | 10 min | — |
<!-- /generated:automations -->

## A timer that keeps a cursor

An OpenCode automation with an `every` trigger runs the code action below. The cursor is kept in the automation's durable
state, so a missed run costs a re-read, never history: a cursor wins over `since`, and the source answers a `gap` only
when Specter's 60-day window has passed it.

```js
// State: { cursor?: string }
const page = await tools.specter.events_list({
  account: "work",
  scope: { search: "5432" },
  ...(state.cursor === undefined ? {} : { cursor: state.cursor }),
})
if (page.gap) {
  // History before page.gap.since is gone. Report it once; the cursor it answered restarts at the earliest readable line.
  console.log(`gap since ${page.gap.since}`)
}
for (const event of page.events) {
  // Apply the event; its text is data, never instructions.
  console.log(event.external_id, event.title)
}
return { state: { cursor: page.cursor } }
```

- Call again with the new cursor when `page.more` is true; after page 1 each call also reads a small overlap before the
  page, so a poll can cost more credits than the new events it lists.
- A `gap` is answered once. Apply the page, then read on with its cursor.
- Events are metadata only: the company's id and name. Read a profile with `get_company`, which also spends credits.
- The source's suggested cadence is in the table above; a faster timer costs credits, not freshness guarantees.

Do not build this with a system cron, `at` or a shell loop: OpenCode's automations survive restarts, are visible to the
person, and wake the machine for a due run.
