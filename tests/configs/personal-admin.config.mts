import { createCoverageConfig } from "../vitest.base.mts";

export default createCoverageConfig({
  name: "personal-admin",
  environment: "happy-dom",
  testFiles: [
    "tests/unit/dashboard/personal-admin.test.tsx",
    "tests/unit/dashboard/personal-key-list.test.tsx",
    "tests/unit/lib/availability/projection-worker.test.ts",
    "tests/unit/lib/circuit-breaker.test.ts",
    "tests/unit/lib/endpoint-circuit-breaker.test.ts",
    "tests/unit/proxy/guard-pipeline-full-chain.test.ts",
    "tests/unit/proxy/guard-pipeline-warmup.test.ts",
    "tests/unit/actions/keys-limit-validation.test.ts",
    "tests/unit/actions/keys-self-service-authz.test.ts",
    "tests/unit/proxy/codex-history-filter.test.ts",
  ],
  sourceFiles: [
    "src/app/[locale]/dashboard/users/api-keys-page-client.tsx",
    "src/app/[locale]/dashboard/_components/dashboard-overview.tsx",
  ],
  thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
});
