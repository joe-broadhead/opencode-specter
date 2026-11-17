# What Specter calls cost

From Specter's public docs, as of 2026-11-17, **not yet confirmed against live responses**. The same facts are in
`src/costs.ts`, and a test keeps this page equal to it. Nothing here decides a permission: the default rules come
only from the classified tool tables.

## Specter's MCP server

Each person gets 100 tool calls a day; within that allowance every call counts as one, free tool or not. Past it, a
call bills the team's API credit pool at the rate below only if a workspace admin turned on **Use API credits for MCP
requests** in Specter's [MCP settings](https://app.tryspecter.com/settings/mcp); otherwise it is declined until the next
day. Source: [Specter MCP - Usage & Pricing](https://intercom.help/specter-labs/en/articles/16439114-specter-mcp-usage-pricing).

| Tool | Cost past the daily allowance |
| --- | --- |
| `find_company` | Free |
| `find_person` | Free (2 credits when resolving via email) |
| `find_investor` | Free |
| `search` | 1 credit per 5 results |
| `get_company_profile` | 1 credit per result |
| `get_company_intelligence` | 3 credits per result |
| `get_company_competitors` | 1 credit per 30 results |
| `get_company_funding_rounds` | 1 credit per result |
| `get_company_acquisitions` | 1 credit per 50 results |
| `get_company_ipos` | 1 credit per result |
| `get_company_latest_revenue` | 1 credit per result |
| `get_company_latest_valuation` | 1 credit per result |
| `get_company_news_signals` | 1 credit per 50 results |
| `get_company_investor_interest_signals` | 1 credit per result |
| `get_person_profile` | 1 credit per result |
| `get_person_email` | 2 credits per result |
| `get_entity_memberships` | Free |
| `get_person_talent_signals` | 1 credit per result |
| `get_investor_profile` | 1 credit per result |
| `get_investor_funding_rounds` | 1 credit per 50 results |
| `get_investor_interest_signals` | 1 credit per result |
| `get_lists` | Free |
| `get_list_items` | 1 credit per result |
| `create_list` | Free |
| `update_list` | Free |
| `delete_list` | Free |
| `get_saved_searches` | Free |
| `get_saved_search_items` | 1 credit per result |
| `create_saved_search` | Free |
| `delete_saved_search` | Free |

## Specter's REST API (the team key)

| Calls | Cost | Source |
| --- | --- | --- |
| List management: get all, create, get, update and delete lists | Free | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| Saved-search management: get all, get and delete a saved search | Free | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| Account: organization members, API call logs, credit balance | Free | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| GET /organization/credits (the key check) | Free; readable even when the budget is spent | [Get credit balance](https://api.tryspecter.com/api-reference/account/get-credit-balance.md) |
| Find company ID; the unauthenticated health check | Free | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| Enrichment and by-ID lookups | Per matched result; a miss costs nothing | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| Paginated feeds | Per request, per page | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| List results and saved-search results | Per result returned | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| Premium data, such as verified email and revenue signals | More per result | [Rate Limits & Credit Limits](https://api.tryspecter.com/api-ref/rate_limits.md) |
| Responses with 400 or 5xx | Not charged | [Errors](https://api.tryspecter.com/api-ref/errors.md) |

Each REST reference page states its exact cost in a note at the top; that note is the source of truth.

## What this plugin's own calls cost

Specter bills the team's plan in credits, and publishes no price per credit. Each call below spends from that one
pool; nothing here is a dollar figure.

| Call | Endpoint | Cost |
| --- | --- | --- |
| `specter_search_companies` | `POST /companies/resolve` | Free |
| `specter_get_company` | `GET /companies/{id}` | 1 credit per result returned; a miss costs nothing |
| `specter_list_saved_searches` | `GET /searches` | Free |
| `specter_saved_search_results` | `GET /searches/companies/{searchId}/results` | 1 credit per result returned |
| `specter.saved`'s read | the same results endpoint, with `new_results_after` | 1 credit per result returned |
| `specter_probe` | `GET /organization/credits` | Free |

A page reports what it spent as `cost: { units: [{ per: "credit", count }] }`: the number of results Specter returned,
the refused ones included, because it charged for them. There is no dollar figure, because Specter publishes none. The
source's `sources` declaration states the same unit, and its `conditions` say that the zero it carries is not a price
(source-contract v0.2.0 requires a `usd` figure for a metered source; this plugin does not invent one).

The source's own reads cost a little more than the companies they list, and that is by design: after the first page it
re-reads the previous page's last five companies, and the next window starts two minutes before the previous window's
first answer. Every company Specter returns is charged, so a poll can cost a few credits more than the events it
carries. A body cut at the read's 8 MB inline limit fails the page instead (`UNAVAILABLE`), so a cut answer is never
listed as a short one.

## What a credit costs

Specter does not publish a price per credit: plans "scale from starter to enterprise", and the price is on request.
A trial of 200 free credits can be requested in the [API Console](https://app.tryspecter.com/settings/api-console).
Source: [Plans & Pricing](https://api.tryspecter.com/api-ref/plans.md).
