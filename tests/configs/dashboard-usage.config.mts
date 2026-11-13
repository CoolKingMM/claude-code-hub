import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "dashboard-usage",
  environment: "happy-dom",
  testFiles: [
    "tests/unit/dashboard/dashboard-usage-range.test.ts",
    "tests/unit/dashboard/dashboard-usage.test.tsx",
    "tests/unit/actions/dashboard-usage.test.ts",
    "tests/unit/repository/dashboard-usage.test.ts",
    "tests/unit/api/v1/dashboard-usage-client.test.ts",
  ],
  sourceFiles: [
    "src/lib/dashboard-usage-range.ts",
    "src/lib/validation/dashboard-usage.ts",
    "src/actions/dashboard-usage.ts",
    "src/repository/dashboard-usage.ts",
    "src/lib/api-client/v1/actions/dashboard-usage.ts",
    "src/app/[locale]/dashboard/_components/dashboard-usage.tsx",
  ],
  thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
});
