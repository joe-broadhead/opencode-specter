import { defineConfig } from "vitest/config"

// Unit and conformance-fixture tests run under Node; the host and pack suites run under Bun (scripts/check.mjs).
export default defineConfig({ test: { include: ["test/unit/**/*.test.ts", "test/conformance/**/*.test.ts"] } })
