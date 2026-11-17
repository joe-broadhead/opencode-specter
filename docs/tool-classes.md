# Specter's MCP tools: a draft classification

**A draft, to be confirmed by a live capture.** The plugin classifies Specter's MCP tools only from a live
`tools/list` of the signed-in server, so this table changes no permission: until then every Specter MCP tool is
treated like a change (see [Permissions](../README.md#permissions)). It is drafted from Specter's public per-tool
rates ([Specter MCP - Usage & Pricing](https://intercom.help/specter-labs/en/articles/16439114-specter-mcp-usage-pricing); see [What Specter calls cost](costs.md)),
which name 30 tools, and from the tools' names. The capture checks the names, and each tool's own annotations
check whether it changes data.

How a class is drafted:

- `read`: free in Specter's table, and its name (`find_…`, `get_…`) says it only reads.
- `spend`: Specter's table gives it a cost, or a case with one (`find_person` costs 2 credits when it resolves an
  email). Past the daily allowance, and only if a Specter admin allows it, a call spends the team's credits.
- `write`: its name (`create_…`, `update_…`, `delete_…`) says it changes Specter data. Free in Specter's table.

Within each person's 100 calls a day, every call counts as one, a free one too. That allowance is not credit spend,
so it does not make a free tool `spend`.

Drafted: 5 read, 20 spend, 5 write.

| Tool | Draft class | Why |
| --- | --- | --- |
| `find_company` | read | Free, and its name says it only reads. |
| `find_person` | spend | Free, except 2 credits when resolving via email: a call may spend credits. |
| `find_investor` | read | Free, and its name says it only reads. |
| `search` | spend | 1 credit per 5 results. |
| `get_company_profile` | spend | 1 credit per result. |
| `get_company_intelligence` | spend | 3 credits per result. |
| `get_company_competitors` | spend | 1 credit per 30 results. |
| `get_company_funding_rounds` | spend | 1 credit per result. |
| `get_company_acquisitions` | spend | 1 credit per 50 results. |
| `get_company_ipos` | spend | 1 credit per result. |
| `get_company_latest_revenue` | spend | 1 credit per result. |
| `get_company_latest_valuation` | spend | 1 credit per result. |
| `get_company_news_signals` | spend | 1 credit per 50 results. |
| `get_company_investor_interest_signals` | spend | 1 credit per result. |
| `get_person_profile` | spend | 1 credit per result. |
| `get_person_email` | spend | 2 credits per result. |
| `get_entity_memberships` | read | Free, and its name says it only reads. |
| `get_person_talent_signals` | spend | 1 credit per result. |
| `get_investor_profile` | spend | 1 credit per result. |
| `get_investor_funding_rounds` | spend | 1 credit per 50 results. |
| `get_investor_interest_signals` | spend | 1 credit per result. |
| `get_lists` | read | Free, and its name says it only reads. |
| `get_list_items` | spend | 1 credit per result. |
| `create_list` | write | Changes Specter data. Free. |
| `update_list` | write | Changes Specter data. Free. |
| `delete_list` | write | Changes Specter data: deletes it, and Specter deletes a list or saved search permanently. Free. |
| `get_saved_searches` | read | Free, and its name says it only reads. |
| `get_saved_search_items` | spend | 1 credit per result. |
| `create_saved_search` | write | Changes Specter data. Free. |
| `delete_saved_search` | write | Changes Specter data: deletes it, and Specter deletes a list or saved search permanently. Free. |
