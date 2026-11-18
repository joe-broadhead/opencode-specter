// What Specter calls cost, as Specter's public docs state it on 2026-11-17. Every fact here is from public docs, not
// yet confirmed against live calls with a key and a seat, and the MCP tool names are not yet checked against a live
// `tools/list`. Nothing here decides a permission: the default rules come from the classified tables only
// (specter-tools.ts). No imports: the status view's bundle may inline this file.

/** Where each fact comes from. */
export const COST_SOURCES = {
  rateLimits: "https://api.tryspecter.com/api-ref/rate_limits.md",
  errors: "https://api.tryspecter.com/api-ref/errors.md",
  plans: "https://api.tryspecter.com/api-ref/plans.md",
  creditBalance: "https://api.tryspecter.com/api-reference/account/get-credit-balance.md",
  mcpPricing: "https://intercom.help/specter-labs/en/articles/16439114-specter-mcp-usage-pricing",
} as const

export type CostSource = keyof typeof COST_SOURCES

/** Free, or `credits` for every `per` results (per 1 when `per` is absent). */
export type Cost = { readonly free: true; readonly note?: string } | { readonly credits: number; readonly per?: number; readonly note?: string }

export const costText = (cost: Cost) =>
  ("free" in cost ? "Free" : `${cost.credits} credit${cost.credits === 1 ? "" : "s"} per ${cost.per ? `${cost.per} results` : "result"}`) + (cost.note ? ` (${cost.note})` : "")

/** MCP tool calls each person makes in a day before any credit is spent; every call counts as one, free or not. */
export const MCP_DAILY_CALLS = 100

/**
 * Specter's per-tool rates for MCP calls past the daily allowance, which bill the team's API credit pool only when a
 * workspace admin turns on "Use API credits for MCP requests"; otherwise those calls are declined until the next day.
 * Source: COST_SOURCES.mcpPricing. Specter's own names, without the `specter_` prefix.
 */
export const MCP_TOOL_COSTS: Readonly<Record<string, Cost>> = {
  find_company: { free: true },
  find_person: { free: true, note: "2 credits when resolving via email" },
  find_investor: { free: true },
  search: { credits: 1, per: 5 },
  get_company_profile: { credits: 1 },
  get_company_intelligence: { credits: 3 },
  get_company_competitors: { credits: 1, per: 30 },
  get_company_funding_rounds: { credits: 1 },
  get_company_acquisitions: { credits: 1, per: 50 },
  get_company_ipos: { credits: 1 },
  get_company_latest_revenue: { credits: 1 },
  get_company_latest_valuation: { credits: 1 },
  get_company_news_signals: { credits: 1, per: 50 },
  get_company_investor_interest_signals: { credits: 1 },
  get_person_profile: { credits: 1 },
  get_person_email: { credits: 2 },
  get_entity_memberships: { free: true },
  get_person_talent_signals: { credits: 1 },
  get_investor_profile: { credits: 1 },
  get_investor_funding_rounds: { credits: 1, per: 50 },
  get_investor_interest_signals: { credits: 1 },
  get_lists: { free: true },
  get_list_items: { credits: 1 },
  create_list: { free: true },
  update_list: { free: true },
  delete_list: { free: true },
  get_saved_searches: { free: true },
  get_saved_search_items: { credits: 1 },
  create_saved_search: { free: true },
  delete_saved_search: { free: true },
}

/** The REST API's cost rules, in Specter's words: each reference page's "Costs …" note is the source of truth. */
export const REST_COST_RULES: readonly { readonly calls: string; readonly cost: string; readonly source: CostSource }[] = [
  { calls: "List management: get all, create, get, update and delete lists", cost: "Free", source: "rateLimits" },
  { calls: "Saved-search management: get all, get and delete a saved search", cost: "Free", source: "rateLimits" },
  { calls: "Account: organization members, API call logs, credit balance", cost: "Free", source: "rateLimits" },
  { calls: "GET /organization/credits (the key check)", cost: "Free; readable even when the budget is spent", source: "creditBalance" },
  { calls: "Find company ID; the unauthenticated health check", cost: "Free", source: "rateLimits" },
  { calls: "Enrichment and by-ID lookups", cost: "Per matched result; a miss costs nothing", source: "rateLimits" },
  { calls: "Paginated feeds", cost: "Per request, per page", source: "rateLimits" },
  { calls: "List results and saved-search results", cost: "Per result returned", source: "rateLimits" },
  { calls: "Premium data, such as verified email and revenue signals", cost: "More per result", source: "rateLimits" },
  { calls: "Responses with 400 or 5xx", cost: "Not charged", source: "errors" },
]

/**
 * What a credit costs in money is not public: Specter's plans "scale from starter to enterprise … Talk to us", and a
 * trial is 200 free credits on request (COST_SOURCES.plans). The plugin still has to state a price in a source's
 * `cost`, which source-contract requires to be dollars, so it states an **estimate** — never a Specter price. It is
 * rounded up from what comparable company-data APIs charge per record, so it overstates rather than understates, and
 * a team's own contract rate replaces it. `package.json` `sources.items[0].cost.units[0].usd` is the same number, and
 * a test keeps the two equal.
 */
export const CREDIT_PRICE_PUBLIC = false
/** The plugin's estimate for one credit, in US dollars: an overstatement, replaced by a team's own rate. */
export const CREDIT_ESTIMATE_USD = 0.1
export const TRIAL_CREDITS = 200

/** One line for status: how MCP calls use credits, as Specter's docs say. */
export const MCP_CREDIT_USE = `${MCP_DAILY_CALLS} tool calls a day per person, each counted as one; past that, a call spends the team's credits at Specter's per-tool rate only if a workspace admin turned on "Use API credits for MCP requests", and is declined otherwise (from Specter's docs, not yet confirmed live)`
