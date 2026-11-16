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

  test("公共设置筛选保留限额等配置，排除凭证、账号和单密钥开关", () => {
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
    ).toEqual({ cost_multiplier: 0.3, limit_total_usd: 10 });
    expect(getSharedProviderUpdate({})).toEqual({});
  });
});
