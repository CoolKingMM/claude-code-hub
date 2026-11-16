import { describe, expect, test, vi } from "vitest";
import { getSharedProviderUpdate } from "@/lib/provider-channel-update";

async function arrange(overrides: Record<string, unknown>[] = [], failId?: number) {
  vi.resetModules();
  const rows = [139, 140, 141].map((id, index) => ({
    id,
    name: index === 0 ? "Agentrouter" : `Agentrouter-${index + 1}`,
    key: `credential-${id}`,
    providerVendorId: 137,
    providerType: "codex",
    groupTag: "codex",
    costMultiplier: "1.0",
    modelRedirects: null,
    allowedModels: null,
    isEnabled: id === 140,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides[index],
  }));
  const update = vi.fn((values: Record<string, unknown>) => ({
    where: () => ({
      returning: async () => {
        const row = rows[update.mock.calls.length - 1];
        if (row.id === failId) throw new Error("write failed");
        Object.assign(row, values);
        return [{ ...row }];
      },
    }),
  }));
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({ orderBy: () => ({ for: async () => rows.map((row) => ({ ...row })) }) }),
      }),
    }),
    update: () => ({ set: update }),
  };
  const transaction = vi.fn(async (run: (tx: unknown) => Promise<unknown>) => {
    const before = rows.map((row) => ({ ...row }));
    try {
      return await run(tx);
    } catch (error) {
      before.forEach((row, index) => {
        rows[index] = row;
      });
      throw error;
    }
  });
  vi.doMock("@/drizzle/db", () => ({ db: { transaction } }));
  vi.doMock("@/repository/provider-endpoints", () => ({}));
  const { updateProviderChannel } = await import("@/repository/provider");
  return { updateProviderChannel, rows, update, transaction };
}

describe("渠道公共设置事务同步", () => {
  test("基础信息、路由、选项、限制、网络及测试配置全部同步", async () => {
    const { updateProviderChannel, update, rows } = await arrange();
    const settings = {
      new_api_access_token: "balance-token",
      new_api_user_id: 42,
      priority: 3,
      weight: 4,
      active_time_start: "08:00",
      allowed_clients: ["codex"],
      preserve_client_ip: true,
      disable_session_reuse: true,
      cache_ttl_preference: "1h" as const,
      codex_reasoning_effort_preference: "high" as const,
      limit_5h_usd: 10,
      limit_daily_usd: 20,
      limit_weekly_usd: 30,
      limit_monthly_usd: 40,
      limit_total_usd: 50,
      limit_concurrent_sessions: 6,
      max_retry_attempts: 2,
      circuit_breaker_failure_threshold: 8,
      proxy_url: "http://proxy.example:8080",
      proxy_fallback_to_direct: true,
      custom_headers: { "x-test": "configured" },
      first_byte_timeout_streaming_ms: 120000,
      streaming_idle_timeout_ms: 60000,
      request_timeout_non_streaming_ms: 180000,
      mcp_passthrough_type: "custom" as const,
      mcp_passthrough_url: "https://example.com/mcp",
    };
    await updateProviderChannel(139, [139, 140, 141], settings);
    const writes = update.mock.calls.map(([values]) => values);
    expect(writes).toHaveLength(3);
    for (const write of writes) {
      const { updatedAt: _updatedAt, ...configuration } = write;
      const { updatedAt: _firstUpdatedAt, ...firstConfiguration } = writes[0];
      expect(configuration).toEqual(firstConfiguration);
      expect(write).toMatchObject({
        newApiAccessToken: "balance-token",
        newApiUserId: 42,
        priority: 3,
        limitTotalUsd: "50",
        proxyUrl: settings.proxy_url,
        mcpPassthroughUrl: settings.mcp_passthrough_url,
      });
    }
    expect(rows.map((row) => row.key)).toEqual([
      "credential-139",
      "credential-140",
      "credential-141",
    ]);
    expect(rows.map((row) => row.isEnabled)).toEqual([false, true, false]);
  });
  test("倍率和模型重定向覆盖三把密钥，凭证、名称和启用状态保留", async () => {
    const { updateProviderChannel, rows, transaction } = await arrange();
    const redirects = [{ matchType: "exact" as const, source: "gpt-5.5", target: "gpt-6.1-sol" }];
    const result = await updateProviderChannel(139, [139, 140, 141], {
      cost_multiplier: 0.3,
      model_redirects: redirects,
      key: "replaced-primary",
    });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(rows.map((row) => row.costMultiplier)).toEqual(["0.3", "0.3", "0.3"]);
    expect(
      rows.every((row) => JSON.stringify(row.modelRedirects) === JSON.stringify(redirects))
    ).toBe(true);
    expect(rows.map((row) => row.isEnabled)).toEqual([false, true, false]);
    expect(rows.map((row) => row.key)).toEqual([
      "replaced-primary",
      "credential-140",
      "credential-141",
    ]);
    expect(rows.map((row) => row.name)).toEqual(["Agentrouter", "Agentrouter-2", "Agentrouter-3"]);
    expect(result.previousProviders.map((row) => row.costMultiplier)).toEqual([1, 1, 1]);
    expect(result.updatedProviders).toHaveLength(3);
    expect(result.addedProviders).toEqual([]);
  });

  test("第二把密钥写入失败时整组回滚，不留下只修改主密钥的结果", async () => {
    const { updateProviderChannel, rows } = await arrange([], 140);
    await expect(
      updateProviderChannel(139, [139, 140, 141], { cost_multiplier: 0.3 })
    ).rejects.toThrow("write failed");
    expect(rows.map((row) => row.costMultiplier)).toEqual(["1.0", "1.0", "1.0"]);
  });

  test("不同分组及模型专用配置拒绝混入同一事务", async () => {
    for (const different of [
      { groupTag: "glm" },
      { allowedModels: [{ matchType: "exact", pattern: "claude-haiku" }] },
    ]) {
      const { updateProviderChannel, update } = await arrange([{}, different]);
      await expect(
        updateProviderChannel(139, [139, 140, 141], { cost_multiplier: 0.3 })
      ).rejects.toThrow("provider.channel_changed");
      expect(update).not.toHaveBeenCalled();
    }
  });

  test("追加重复密钥失败时也回滚公共设置", async () => {
    const { updateProviderChannel, rows } = await arrange();
    await expect(
      updateProviderChannel(139, [139, 140, 141], { cost_multiplier: 0.3 }, [
        { key: "credential-139", is_enabled: true },
      ])
    ).rejects.toThrow("duplicateKey");
    expect(rows.map((row) => row.costMultiplier)).toEqual(["1.0", "1.0", "1.0"]);
  });

  test("公共设置筛选包含基础信息和限额配置，排除 API 凭证和单密钥开关", () => {
    expect(
      getSharedProviderUpdate({
        name: "label",
        key: "secret",
        is_enabled: false,
        new_api_access_token: "account-secret",
        new_api_user_id: 4,
        cost_multiplier: 0.3,
        limit_total_usd: 10,
      })
    ).toEqual({
      new_api_access_token: "account-secret",
      new_api_user_id: 4,
      cost_multiplier: 0.3,
      limit_total_usd: 10,
    });
    expect(getSharedProviderUpdate({})).toEqual({});
  });
});
