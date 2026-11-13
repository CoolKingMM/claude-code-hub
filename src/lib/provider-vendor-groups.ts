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
