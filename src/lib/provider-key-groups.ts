import type { ProviderDisplay } from "@/types/provider";
import { normalizeProviderGroup, resolveProviderGroupsWithDefault } from "./utils/provider-group";

type ChannelProvider = Pick<
  ProviderDisplay,
  "id" | "providerVendorId" | "providerType" | "groupTag"
>;

function channelScope(provider: ChannelProvider): unknown[] {
  return [
    provider.providerVendorId ?? -provider.id,
    provider.providerType,
    normalizeProviderGroup(provider.groupTag),
  ];
}

/** Use a configuration ID to identify equal credentials without exposing the key or its hash. */
export function buildProviderKeyGroupIds(
  providers: readonly (ChannelProvider & { key: string })[]
): Map<number, number> {
  const groups = new Map<string, number>();
  const ids = new Map<number, number>();
  for (const provider of providers.toSorted((left, right) => left.id - right.id)) {
    const identity = JSON.stringify([...channelScope(provider), provider.key || provider.id]);
    const id = groups.get(identity) ?? provider.id;
    groups.set(identity, id);
    ids.set(provider.id, id);
  }
  return ids;
}

/** Masked keys are display text and must never be used to determine credential equality. */
export function groupProviderKeyConfigurations<T extends ChannelProvider & { keyGroupId?: number }>(
  providers: readonly T[]
): T[][] {
  const groups = new Map<string, T[]>();
  for (const provider of providers.toSorted((left, right) => left.id - right.id)) {
    const identity = JSON.stringify([
      ...channelScope(provider),
      provider.keyGroupId ?? provider.id,
    ]);
    const configurations = groups.get(identity) ?? [];
    configurations.push(provider);
    groups.set(identity, configurations);
  }
  return Array.from(groups.values());
}

export interface ProviderRequestFilterSummary {
  id: number;
  name: string;
  target: string;
  isEnabled: boolean;
  bindingType: string;
  providerIds: number[] | null;
  groupTags: string[] | null;
}

export function matchesProviderRequestFilter(
  filter: ProviderRequestFilterSummary,
  provider: Pick<ProviderDisplay, "id" | "groupTag">
): boolean {
  if (filter.bindingType === "global") return true;
  if (filter.bindingType === "providers") return filter.providerIds?.includes(provider.id) ?? false;
  if (filter.bindingType === "groups") {
    return resolveProviderGroupsWithDefault(provider.groupTag).some((group) =>
      filter.groupTags?.includes(group)
    );
  }
  return false;
}
