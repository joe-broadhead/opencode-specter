// `events_list`: the saved-search feed. The register resolves the account (the cursor and the page belong to it); the
// provider reads with the team key; the cursor's scope is the saved search's id.
import { EVENT_LIMITS, PAGE_SCHEMA } from "@we-the-rebel-alliance/plugin-contract/events"
import { RETENTION_DAYS, SCOPE_KEY, SOURCE } from "../provider/saved.js"
import { STRING } from "./schemas.js"
import type { HandlerDeps } from "./types.js"

const EVENTS_INPUT = {
  type: "object",
  additionalProperties: false,
  required: ["scope"],
  properties: {
    source: { type: "string", enum: [SOURCE], description: "The one source this plugin lists; saved." },
    scope: {
      type: "object",
      additionalProperties: false,
      required: [SCOPE_KEY],
      properties: {
        [SCOPE_KEY]: {
          type: "string",
          minLength: 1,
          maxLength: 20,
          description: "The saved company search's id, as the free saved-search list shows it. The search must be shared to the API.",
        },
      },
      description: "The saved search to read: one per read.",
    },
    cursor: {
      type: "string",
      minLength: 1,
      maxLength: EVENT_LIMITS.cursor,
      description: "The previous result's cursor, to list what came after it. It wins over since, and it is bound to the same search.",
    },
    since: {
      type: "string",
      maxLength: 40,
      description: `Where to start when there is no cursor: an ISO date (a UTC day) or an ISO date-time with Z or an offset. Default: 24 hours ago. Specter keeps additions for ${RETENTION_DAYS} days.`,
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 500,
      description: "Most events to return, 1 to 500; 100 by default.",
    },
  },
} as const

export function createEventsHandler(deps: HandlerDeps) {
  return {
    description:
      "List the companies Specter added to one saved company search since a cursor, as normalised events, oldest first, metadata only (id, name). " +
      "Pass scope.search and the previous result's cursor; without a cursor it starts at since, or 24 hours ago. " +
      "It spends 1 credit per company returned; to read a company in full, use get_company.",
    input: EVENTS_INPUT,
    output: PAGE_SCHEMA,
    async run(input: Readonly<Record<string, unknown>>, call: { readonly account: string; readonly signal: AbortSignal }) {
      return deps.provider.savedSearchPage(input, call.account, call.signal)
    },
  }
}
