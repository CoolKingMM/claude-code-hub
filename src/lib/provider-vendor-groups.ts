import type { ProviderDisplay } from "@/types/provider";

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

// 同一供应商的不同接口类型仍是独立渠道。
export function groupProvidersByChannel<
  T extends Pick<ProviderDisplay, "id" | "providerVendorId" | "providerType">,
>(providers: readonly T[]): Array<{ channelId: string; providers: T[] }> {
  const groups = new Map<string, T[]>();
  for (const provider of providers) {
    const channelId =
      provider.providerVendorId && provider.providerVendorId > 0
        ? `${provider.providerVendorId}:${provider.providerType}`
        : `provider:${provider.id}`;
    const keys = groups.get(channelId) ?? [];
    keys.push(provider);
    groups.set(channelId, keys);
  }
  return Array.from(groups, ([channelId, keys]) => ({ channelId, providers: keys }));
}
