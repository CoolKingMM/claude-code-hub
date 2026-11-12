import { describe, expect, test } from "vitest";
import { PROVIDER_KEY_MAX_LENGTH } from "@/lib/constants/provider.constants";
import {
  buildProviderKeyEntries,
  PROVIDER_KEY_BATCH_MAX,
  validateProviderKeys,
} from "@/lib/provider-key-batch";
import { ADDITIONAL_PROVIDER_KEYS_SCHEMA } from "@/lib/validation/provider-keys";
import { CreateProviderSchema } from "@/lib/validation/schemas";
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

  test("创建 API 接受多密钥，更新 API 不接受批量创建字段", () => {
    const data = {
      name: "relay",
      url: "https://relay.example.com",
      key: "one",
      additional_keys: [{ key: "two", is_enabled: false }],
    };
    expect(ProviderCreateSchema.parse(data).additional_keys).toEqual(data.additional_keys);
    expect(CreateProviderSchema.parse(data).additional_keys).toEqual(data.additional_keys);
    expect(ProviderUpdateSchema.safeParse({ additional_keys: data.additional_keys }).success).toBe(
      false
    );
    expect(
      CreateProviderSchema.safeParse({ ...data, additional_keys: [{ key: " one " }] }).success
    ).toBe(false);
    expect(CreateProviderSchema.safeParse({ ...data, key: " " }).success).toBe(false);
  });
});
