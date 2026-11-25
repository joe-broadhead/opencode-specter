import { describe, expect, test } from "vitest"
import {
  COMPANY_ID,
  SEARCH_ID,
  companiesOf,
  companyOf,
  companyView,
  resolvedOf,
  savedSearchOption,
  searchesOf,
} from "../../src/provider/companies.js"
import { COMPANIES, RESOLVE, SEARCH_LIST } from "./helpers.js"

describe("company records", () => {
  test("reads the fields the plugin uses, and nothing else", () => {
    const company = companyOf({ ...COMPANIES.hedgehog, unknown_field: "dropped" })
    expect(company).toMatchObject({ id: "hedgehog-co", organization_name: "Hedgehog Labs", industry: "Software", employee_count: 42 })
    expect(companyView(company!)).toMatchObject({ id: "hedgehog-co", name: "Hedgehog Labs", domain: "hedgehog.example", city: "Bristol", industry: "Software", growthStage: "seed", totalFundingUsd: 1_000_000 })
  })

  test("refuses a record with no usable id, and keeps a string founding year", () => {
    expect(companyOf({ organization_name: "No id" })).toBeUndefined()
    expect(companyOf({ id: "no spaces here" })).toBeUndefined()
    expect(companyOf({ id: "company-1", founded_year: "2018" })?.founded_year).toBe(2018)
  })

  test("a results body with an unrecognised company fails the whole page, never drops it", () => {
    expect(companiesOf([COMPANIES.hedgehog])).toHaveLength(1)
    expect(() => companiesOf({ items: [] })).toThrow(/UNAVAILABLE: Specter's saved-search results answer/)
    expect(() => companiesOf([COMPANIES.hedgehog, { organization_name: "No id" }])).toThrow(/does not recognise/)
  })

  test("the saved-search list keeps an array or an items object, and only integer ids", () => {
    expect(searchesOf(SEARCH_LIST).map((search) => search.id)).toEqual([5432, 7788, 9012])
    expect(searchesOf({ items: SEARCH_LIST })).toHaveLength(3)
    expect(searchesOf([{ id: "not-a-number" }, { id: 12.5 }])).toEqual([])
    expect(() => searchesOf("nope")).toThrow(/UNAVAILABLE/)
  })

  test("a saved search's option carries the product and the counts", () => {
    expect(savedSearchOption({ id: 5432, name: "Bristol software", product_type: "company", new_count: 2, full_count: 2 })).toEqual({
      id: "5432",
      label: "Bristol software (company, 2 new, 2 total)",
    })
    expect(savedSearchOption({ id: 1 })).toEqual({ id: "1", label: "Untitled search (unknown product)" })
  })

  test("the resolve answer is matched by position, not by its normalised echo", () => {
    expect(resolvedOf(RESOLVE, ["www.hedgehog.example"])).toEqual([
      { domain: "www.hedgehog.example", matches: [{ id: "hedgehog-co", name: "Hedgehog Labs", domain: "hedgehog.example", city: "Bristol", country: "GB", foundedYear: 2019, confidence: 0.98 }] },
    ])
    expect(() => resolvedOf(RESOLVE, ["hedgehog.example", "otter.example"])).toThrow(/2 domains/)
    expect(() => resolvedOf({}, ["hedgehog.example"])).toThrow(/not the array/)
  })

  test("the id patterns are the reference's", () => {
    expect(COMPANY_ID.test("hedgehog-co")).toBe(true)
    expect(COMPANY_ID.test("a b")).toBe(false)
    expect(SEARCH_ID.test("5432")).toBe(true)
    expect(SEARCH_ID.test("-1")).toBe(false)
  })
})
