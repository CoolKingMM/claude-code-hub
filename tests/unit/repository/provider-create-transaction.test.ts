import { describe, expect, test, vi } from "vitest";

type ProviderRow = Record<string, unknown>;

function createProviderRow(overrides: Partial<ProviderRow> = {}): ProviderRow {
  const now = new Date("2025-01-01T00:00:00.000Z");

  return {
    id: 101,
    name: "Provider A",
    url: "https://new.example.com/v1/messages",
    key: "test-key",
    providerVendorId: 11,
    isEnabled: true,
    weight: 1,
    priority: 0,
    costMultiplier: "1.0",
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 10000,
    requestTimeoutNonStreamingMs: 600000,
    websiteUrl: "https://vendor.example.com",
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    codexImageGenerationPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  };
}

function createCreateProviderInput(overrides: Record<string, unknown> = {}) {
  return {
    name: "Provider A",
    url: "https://new.example.com/v1/messages",
    key: "test-key",
    provider_type: "claude",
    website_url: "https://vendor.example.com",
    favicon_url: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    ...overrides,
  };
}

function createDbMock(insertedRow: ProviderRow) {
  const insertReturningMock = vi.fn(async () => [insertedRow]);
  const insertValuesMock = vi.fn(() => ({ returning: insertReturningMock }));
  const insertMock = vi.fn(() => ({ values: insertValuesMock }));

  const updateReturningMock = vi.fn(async () => [insertedRow]);
  const updateMock = vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn(() => ({ returning: updateReturningMock })) })),
  }));
  const tx = {
    insert: insertMock,
    update: updateMock,
  };

  const transactionMock = vi.fn(async (runInTx: (trx: typeof tx) => Promise<unknown>) => {
    return runInTx(tx);
  });

  return {
    db: {
      transaction: transactionMock,
    },
    mocks: {
      transactionMock,
      insertMock,
      insertValuesMock,
      insertReturningMock,
      updateReturningMock,
    },
  };
}

describe("provider repository - createProvider transactional endpoint seeding", () => {
  test("编辑与追加共享事务，新密钥沿用现有 vendor，保留原密钥", async () => {
    vi.resetModules();
    const dbState = createDbMock(
      createProviderRow({ key: "original", providerVendorId: 11, name: "saved-name" })
    );
    vi.doMock("@/drizzle/db", () => ({ db: dbState.db }));
    const resolveVendor = vi.fn(async () => 22);
    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: resolveVendor,
      ensureProviderEndpointExistsForUrl: vi.fn(async () => true),
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));
    const { updateProviderWithKeys } = await import("@/repository/provider");
    const result = await updateProviderWithKeys(101, { name: "saved-name" }, [
      { key: "new-key", is_enabled: false },
    ]);
    expect(result?.provider.key).toBe("original");
    expect(dbState.mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(dbState.mocks.insertValuesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "new-key",
        isEnabled: false,
        providerVendorId: 11,
        name: "saved-name-2",
      })
    );
    expect(resolveVendor).not.toHaveBeenCalled();
  });

  test("追加重复原密钥或写入失败时拒绝整个更新事务", async () => {
    vi.resetModules();
    const dbState = createDbMock(createProviderRow({ key: "original" }));
    vi.doMock("@/drizzle/db", () => ({ db: dbState.db }));
    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: vi.fn(async () => 11),
      ensureProviderEndpointExistsForUrl: vi.fn(async () => true),
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));
    const { updateProviderWithKeys } = await import("@/repository/provider");
    await expect(
      updateProviderWithKeys(101, { name: "changed" }, [{ key: "original", is_enabled: true }])
    ).rejects.toThrow("duplicateKey");
    expect(dbState.mocks.insertMock).not.toHaveBeenCalled();
    dbState.mocks.insertReturningMock.mockRejectedValueOnce(new Error("append failed"));
    await expect(
      updateProviderWithKeys(101, { name: "changed" }, [{ key: "new", is_enabled: true }])
    ).rejects.toThrow("append failed");
    await expect(dbState.mocks.transactionMock.mock.results[1].value).rejects.toThrow(
      "append failed"
    );
  });

  test("多个密钥共享单一事务，分别保存启用状态", async () => {
    vi.resetModules();
    const dbState = createDbMock(createProviderRow());
    dbState.mocks.insertReturningMock
      .mockResolvedValueOnce([createProviderRow({ id: 101, key: "one", isEnabled: false })])
      .mockResolvedValueOnce([createProviderRow({ id: 102, key: "two", isEnabled: true })]);
    vi.doMock("@/drizzle/db", () => ({ db: dbState.db }));
    const resolveVendor = vi.fn(async (_input: unknown, _options: { tx: unknown }) => 11);
    const seedEndpoint = vi.fn(async (_input: unknown, _options: { tx: unknown }) => true);
    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: resolveVendor,
      ensureProviderEndpointExistsForUrl: seedEndpoint,
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));
    const { createProviders } = await import("@/repository/provider");
    const result = await createProviders([
      createCreateProviderInput({ key: "one", is_enabled: false }),
      createCreateProviderInput({ key: "two", is_enabled: true }),
    ]);
    expect(result.map((provider) => [provider.id, provider.isEnabled])).toEqual([
      [101, false],
      [102, true],
    ]);
    expect(dbState.mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(dbState.mocks.insertValuesMock.mock.calls).toEqual([
      [expect.objectContaining({ key: "one", isEnabled: false })],
      [expect.objectContaining({ key: "two", isEnabled: true })],
    ]);
    expect(resolveVendor.mock.calls[0][1].tx).toBe(resolveVendor.mock.calls[1][1].tx);
    expect(seedEndpoint.mock.calls[0][1].tx).toBe(resolveVendor.mock.calls[0][1].tx);
  });

  test("后续密钥失败会拒绝整个事务，并停止剩余写入", async () => {
    vi.resetModules();
    const dbState = createDbMock(createProviderRow());
    dbState.mocks.insertReturningMock
      .mockResolvedValueOnce([createProviderRow()])
      .mockRejectedValueOnce(new Error("insert failed"));
    vi.doMock("@/drizzle/db", () => ({ db: dbState.db }));
    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: vi.fn(async () => 11),
      ensureProviderEndpointExistsForUrl: vi.fn(async () => true),
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));
    const { createProviders } = await import("@/repository/provider");
    await expect(
      createProviders(["one", "two", "three"].map((key) => createCreateProviderInput({ key })))
    ).rejects.toThrow("insert failed");
    expect(dbState.mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(dbState.mocks.insertMock).toHaveBeenCalledTimes(2);
    await expect(dbState.mocks.transactionMock.mock.results[0].value).rejects.toThrow(
      "insert failed"
    );
  });

  test("createProvider should execute vendor resolve + provider insert + endpoint seed in one transaction", async () => {
    vi.resetModules();

    const dbState = createDbMock(
      createProviderRow({
        providerType: "codex",
        url: "https://new.example.com/v1/responses",
      })
    );

    vi.doMock("@/drizzle/db", () => ({
      db: dbState.db,
    }));

    const getOrCreateProviderVendorIdFromUrlsMock = vi.fn(async () => 11);
    const ensureProviderEndpointExistsForUrlMock = vi.fn(async () => true);

    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: getOrCreateProviderVendorIdFromUrlsMock,
      ensureProviderEndpointExistsForUrl: ensureProviderEndpointExistsForUrlMock,
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));

    const { createProvider } = await import("@/repository/provider");
    const provider = await createProvider(
      createCreateProviderInput({
        provider_type: "codex",
        url: "https://new.example.com/v1/responses",
      })
    );

    expect(provider.id).toBe(101);
    expect(dbState.mocks.transactionMock).toHaveBeenCalledTimes(1);
    expect(dbState.mocks.insertMock).toHaveBeenCalledTimes(1);

    expect(getOrCreateProviderVendorIdFromUrlsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerUrl: "https://new.example.com/v1/responses",
      }),
      expect.objectContaining({ tx: expect.any(Object) })
    );

    expect(ensureProviderEndpointExistsForUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: 11,
        providerType: "codex",
        url: "https://new.example.com/v1/responses",
      }),
      expect.objectContaining({ tx: expect.any(Object) })
    );
  });

  test("createProvider should bubble endpoint seed errors to avoid partial success", async () => {
    vi.resetModules();

    const dbState = createDbMock(createProviderRow());

    vi.doMock("@/drizzle/db", () => ({
      db: dbState.db,
    }));

    const getOrCreateProviderVendorIdFromUrlsMock = vi.fn(async () => 11);
    const ensureProviderEndpointExistsForUrlMock = vi.fn(async () => {
      throw new Error("endpoint seed failed");
    });

    vi.doMock("@/repository/provider-endpoints", () => ({
      getOrCreateProviderVendorIdFromUrls: getOrCreateProviderVendorIdFromUrlsMock,
      ensureProviderEndpointExistsForUrl: ensureProviderEndpointExistsForUrlMock,
      syncProviderEndpointOnProviderEdit: vi.fn(),
      tryDeleteProviderVendorIfEmpty: vi.fn(),
    }));

    const { createProvider } = await import("@/repository/provider");

    await expect(createProvider(createCreateProviderInput())).rejects.toThrow(
      "endpoint seed failed"
    );
    expect(dbState.mocks.transactionMock).toHaveBeenCalledTimes(1);
  });
});
