import type { ProviderDisplay } from "@/types/provider";
import { normalizeAllowedModelRules } from "./allowed-model-rules";
import { normalizeProviderModelRedirectRules } from "./provider-model-redirects";
import { normalizeProviderGroup } from "./utils/provider-group";

type ChannelConfiguration = Partial<
  Pick<
    ProviderDisplay,
    | "groupTag"
    | "allowedModels"
    | "modelRedirects"
    | "anthropicThinkingBudgetPreference"
    | "anthropicAdaptiveThinking"
  >
>;

/** Same-model credentials share a row; model-specific configurations remain visible. */
function configurationKey(provider: ChannelConfiguration): string {
  const models = (normalizeAllowedModelRules(provider.allowedModels) ?? [])
    .map((rule) => [rule.matchType, rule.pattern])
    .toSorted((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  const redirects = normalizeProviderModelRedirectRules(provider.modelRedirects) ?? [];
  const budget = provider.anthropicThinkingBudgetPreference;
  const thinkingBudget = !budget || budget === "inherit" ? null : budget;
  const adaptive = provider.anthropicAdaptiveThinking ?? null;
  const group = normalizeProviderGroup(provider.groupTag);
  if (group === "default" && !models.length && !redirects.length && !thinkingBudget && !adaptive) {
    return "";
  }
  return `:${JSON.stringify([group, models, redirects, thinkingBudget, adaptive])}`;
}

// 缺少 vendor 的记录各自显示，不能将所有未知服务商合并为一个条目。
export function groupProvidersByVendor<T extends Pick<ProviderDisplay, "id" | "providerVendorId">>(
  providers: readonly T[]
): Array<{ vendorId: number; providers: T[] }> {
  const groups = new Map<number, T[]>();
  for (const provider of providers) {
    const id = provider.providerVendorId;
    const vendorId = id && id > 0 ? id : -provider.id;
    const items = groups.get(vendorId) ?? [];
    items.push(provider);
    groups.set(vendorId, items);
  }
  return Array.from(groups, ([vendorId, items]) => ({ vendorId, providers: items }));
}

// 同一供应商按接口类型及模型配置分别显示，多密钥仍共享对应配置的列表行。
export function groupProvidersByChannel<
  T extends Pick<ProviderDisplay, "id" | "providerVendorId" | "providerType"> &
    ChannelConfiguration,
>(providers: readonly T[]): Array<{ channelId: string; providers: T[] }> {
  const groups = new Map<string, T[]>();
  for (const provider of providers) {
    const channelId =
      provider.providerVendorId && provider.providerVendorId > 0
        ? `${provider.providerVendorId}:${provider.providerType}${configurationKey(provider)}`
        : `provider:${provider.id}`;
    const keys = groups.get(channelId) ?? [];
    keys.push(provider);
    groups.set(channelId, keys);
  }
  return Array.from(groups, ([channelId, keys]) => ({ channelId, providers: keys }));
}
