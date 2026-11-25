// `events_list`: the saved-search feed. The register resolves the account (the cursor and the page belong to it); the
// provider reads with the team key; the cursor's scope is the saved search's id.
import { EVENTS_LIST_INPUT_SCHEMA, PAGE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import type { HandlerDeps } from "./types.js"

export function createEventsHandler(deps: HandlerDeps) {
  return {
    description:
      "List the companies Specter added to one saved company search since a cursor, as normalised events, oldest first, metadata only (id, name). " +
      "Pass scope.search and the previous result's cursor; without a cursor it starts at since, or 24 hours ago. " +
      "It spends 1 credit per company returned; to read a company in full, use get_company.",
    input: EVENTS_LIST_INPUT_SCHEMA,
    output: PAGE_SCHEMA,
    async run(input: Readonly<Record<string, unknown>>, call: { readonly account: string; readonly signal: AbortSignal }) {
      return deps.provider.savedSearchPage(input, call.account, call.signal)
    },
  }
}
