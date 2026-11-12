import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "provider-key-batch",
  environment: "happy-dom",
  testFiles: [
    "tests/unit/providers/provider-key-batch.test.ts",
    "tests/unit/settings/providers/provider-keys-input.test.tsx",
    "tests/unit/settings/providers/provider-form-base-url-guidance.test.tsx",
    "tests/unit/settings/providers/provider-form-new-api-access.test.ts",
    "tests/unit/settings/providers/provider-form-endpoint-pool.test.tsx",
    "tests/unit/settings/providers/provider-form-total-limit-ui.test.tsx",
    "tests/unit/api/v1/provider-schemas-key-length.test.ts",
    "tests/unit/actions/providers.test.ts",
    "tests/unit/repository/provider-create-transaction.test.ts",
  ],
  sourceFiles: [
    "src/lib/provider-key-batch.ts",
    "src/lib/validation/provider-keys.ts",
    "src/app/[locale]/settings/providers/_components/forms/provider-form/components/provider-keys-input.tsx",
  ],
  thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
});
