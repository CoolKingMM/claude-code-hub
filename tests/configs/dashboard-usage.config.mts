import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "dashboard-usage",
  environment: "happy-dom",
  testFiles: [
    "src/components/customs/thinking-effort-badge.test.ts",
    "tests/unit/dashboard/dashboard-usage-range.test.ts",
    "tests/unit/dashboard/dashboard-usage.test.tsx",
    "tests/unit/dashboard/dashboard-model-breakdown.test.tsx",
    "tests/unit/actions/dashboard-usage.test.ts",
    "tests/unit/repository/dashboard-usage.test.ts",
    "tests/unit/api/v1/dashboard-usage-client.test.ts",
    "tests/unit/proxy/client-error-message.test.ts",
    "tests/unit/proxy/error-handler-client-message.test.ts",
    "tests/unit/proxy/error-handler-upstream-message-passthrough.test.ts",
    "tests/unit/proxy/hedge-upstream-message-candidate.test.ts",
    "tests/unit/proxy/hedge-error-pipeline.test.ts",
  ],
  sourceFiles: [
    "src/lib/dashboard-usage-range.ts",
    "src/lib/utils/token.ts",
    "src/app/v1/_lib/proxy/client-error-message.ts",
    "src/lib/validation/dashboard-usage.ts",
    "src/actions/dashboard-usage.ts",
    "src/repository/dashboard-usage.ts",
    "src/lib/api-client/v1/actions/dashboard-usage.ts",
    "src/app/[locale]/dashboard/_components/dashboard-usage.tsx",
    "src/app/[locale]/dashboard/_components/dashboard-model-breakdown.tsx",
  ],
  thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 },
});
