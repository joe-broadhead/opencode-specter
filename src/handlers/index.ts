// The plugin's one handler table: one handler per method the manifest declares, and nothing else. `register` wires
// every handler through the agent tool, Code Mode and RPC, resolves the account, applies the access rules and checks
// every input and answer, so no handler writes door code.
import type { HandlerTable } from "@we-the-rebel-alliance/plugin-contract/register"
import { createEventsHandler } from "./events_list.js"
import { createGetCompanyHandler } from "./get_company.js"
import { createListSavedSearchesHandler } from "./list_saved_searches.js"
import { createProbeHandler } from "./probe.js"
import { createSavedSearchResultsHandler } from "./saved_search_results.js"
import { createSearchCompaniesHandler } from "./search_companies.js"
import { createStatusHandler } from "./status.js"
import type { HandlerDeps } from "./types.js"

export function createHandlers(deps: HandlerDeps): HandlerTable {
  return {
    status: createStatusHandler(deps),
    probe: createProbeHandler(deps),
    events_list: createEventsHandler(deps),
    search_companies: createSearchCompaniesHandler(deps),
    get_company: createGetCompanyHandler(deps),
    list_saved_searches: createListSavedSearchesHandler(deps),
    saved_search_results: createSavedSearchResultsHandler(deps),
  }
}

export type { HandlerDeps, ServerView } from "./types.js"
