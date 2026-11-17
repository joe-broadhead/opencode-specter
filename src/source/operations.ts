// The two provider operations the plugin asserts on a resource, `<account>:<operation>`, rather than on `*`. They live
// apart from the source so the default rules (`permissions.ts`) can name them without pulling the source's contract
// module — and its size — into the status dialog's bundle.
//
// Both come from Specter's public API reference, unverified live: the saved-search results endpoint, and the free
// saved-search list that `scope.suggest` binds.

/** The company saved-search results read: `GET /searches/companies/{searchId}/results`. */
export const RESULTS_OPERATION = "searches.companies.results"

/** The saved-search list: `GET /searches`, the source's `scope.suggest`. */
export const SUGGEST_OPERATION = "searches.list"
