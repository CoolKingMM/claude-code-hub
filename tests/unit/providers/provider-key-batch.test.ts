import { describe, expect, test } from "vitest";
import { PROVIDER_KEY_MAX_LENGTH } from "@/lib/constants/provider.constants";
import {
  buildProviderKeyEntries,
  PROVIDER_KEY_BATCH_MAX,
  validateProviderKeys,
} from "@/lib/provider-key-batch";
import { buildAdditionalProviderData } from "@/lib/provider-key-clone";
import type { Provider } from "@/types/provider";
import { ADDITIONAL_PROVIDER_KEYS_SCHEMA } from "@/lib/validation/provider-keys";
import { CreateProviderSchema, UpdateProviderSchema } from "@/lib/validation/schemas";
import { ProviderCreateSchema, ProviderUpdateSchema } from "@/lib/api/v1/schemas/providers";

describe("服务商多密钥校验", () => {
  test("保留顺序和独立开关，并在提交时移除两端空白", () => {
    expect(
      buildProviderKeyEntries({
        key: " primary ",
        keyIsEnabled: false,
        additionalKeys: [{ key: " secondary ", is_enabled: true }],
      })
    ).toEqual([
      { key: "primary", is_enabled: false },
      { key: "secondary", is_enabled: true },
    ]);
    expect(buildProviderKeyEntries({ key: "one" })).toEqual([{ key: "one", is_enabled: true }]);
  });

  test("追加密钥继承配置，保持开关独立，不复制累计用量或历史状态", () => {
    const provider = {
      name: "x".repeat(64),
      url: "https://relay.example.com",
      key: "original",
      isEnabled: false,
      priority: 8,
      weight: 7,
      customHeaders: { "x-header": "value" },
      groupTag: "group",
      providerVendorId: 10,
      newApiAccessToken: "balance-token",
      newApiUserId: 9,
      totalCostResetAt: new Date(),
      createdAt: new Date(),
    } as unknown as Provider;
    const output = buildAdditionalProviderData(provider, [{ key: " new ", is_enabled: true }]);
    expect(output[0]).toMatchObject({
      name: `${"x".repeat(62)}-2`,
      key: "new",
      is_enabled: true,
      priority: 8,
      weight: 7,
      custom_headers: { "x-header": "value" },
      group_tag: "group",
      new_api_access_token: "balance-token",
      new_api_user_id: 9,
    });
    expect(output[0]).not.toHaveProperty("totalCostResetAt");
    expect(output[0]).not.toHaveProperty("createdAt");
    expect(provider.key).toBe("original");
  });

  test("至少需要一个密钥，空白行必须填写或移除", () => {
    expect(validateProviderKeys([])).toBe("keyRequired");
    expect(validateProviderKeys([{ key: "  ", is_enabled: false }])).toBe("keyRequired");
  });

  test("长度边界与单密钥一致", () => {
    expect(
      validateProviderKeys([{ key: "k".repeat(PROVIDER_KEY_MAX_LENGTH), is_enabled: true }])
    ).toBeNull();
    expect(
      validateProviderKeys([{ key: "k".repeat(PROVIDER_KEY_MAX_LENGTH + 1), is_enabled: true }])
    ).toBe("keyTooLong");
  });

  test("包括关闭的密钥在内，移除空白后不允许重复", () => {
    expect(
      validateProviderKeys([
        { key: "key", is_enabled: true },
        { key: " key ", is_enabled: false },
      ])
    ).toBe("duplicateKey");
  });

  test("每组最多 50 个密钥", () => {
    const entries = Array.from({ length: PROVIDER_KEY_BATCH_MAX }, (_, i) => ({
      key: `key-${i}`,
      is_enabled: true,
    }));
    expect(validateProviderKeys(entries)).toBeNull();
    expect(validateProviderKeys([...entries, { key: "extra", is_enabled: true }])).toBe(
      "tooManyKeys"
    );
    expect(ADDITIONAL_PROVIDER_KEYS_SCHEMA.safeParse(entries).success).toBe(false);
  });

  test("服务端默认启用，并拒绝空白、过长和未知字段", () => {
    expect(ADDITIONAL_PROVIDER_KEYS_SCHEMA.parse([{ key: " key " }])).toEqual([
      { key: "key", is_enabled: true },
    ]);
    expect(ADDITIONAL_PROVIDER_KEYS_SCHEMA.parse(undefined)).toBeUndefined();
    for (const entry of [
      { key: " " },
      { key: "k".repeat(PROVIDER_KEY_MAX_LENGTH + 1) },
      { key: "key", unknown: true },
      { key: "key", is_enabled: "false" },
    ]) {
      expect(ADDITIONAL_PROVIDER_KEYS_SCHEMA.safeParse([entry]).success).toBe(false);
    }
  });

  test("创建与更新 API 均接受多密钥，更新时原密钥可不提交", () => {
    const data = {
      name: "relay",
      url: "https://relay.example.com",
      key: "one",
      additional_keys: [{ key: "two", is_enabled: false }],
    };
    expect(ProviderCreateSchema.parse(data).additional_keys).toEqual(data.additional_keys);
    expect(CreateProviderSchema.parse(data).additional_keys).toEqual(data.additional_keys);
    expect(
      ProviderUpdateSchema.parse({ additional_keys: data.additional_keys }).additional_keys
    ).toEqual(data.additional_keys);
    expect(
      UpdateProviderSchema.parse({ additional_keys: data.additional_keys }).additional_keys
    ).toEqual(data.additional_keys);
    expect(
      CreateProviderSchema.safeParse({ ...data, additional_keys: [{ key: " one " }] }).success
    ).toBe(false);
    expect(CreateProviderSchema.safeParse({ ...data, key: " " }).success).toBe(false);
  });
});
