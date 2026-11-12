import { PROVIDER_KEY_MAX_LENGTH } from "@/lib/constants/provider.constants";

export const PROVIDER_KEY_BATCH_MAX = 50;

export interface ProviderKeyEntry {
  key: string;
  is_enabled: boolean;
}

export function validateProviderKeys(
  entries: readonly ProviderKeyEntry[]
): "keyRequired" | "keyTooLong" | "duplicateKey" | "tooManyKeys" | null {
  if (entries.length === 0) return "keyRequired";
  if (entries.length > PROVIDER_KEY_BATCH_MAX) return "tooManyKeys";
  const seen = new Set<string>();
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key) return "keyRequired";
    if (key.length > PROVIDER_KEY_MAX_LENGTH) return "keyTooLong";
    if (seen.has(key)) return "duplicateKey";
    seen.add(key);
  }
  return null;
}

export function buildProviderKeyEntries(basic: {
  key: string;
  keyIsEnabled?: boolean;
  additionalKeys?: ProviderKeyEntry[];
}): ProviderKeyEntry[] {
  return [
    { key: basic.key.trim(), is_enabled: basic.keyIsEnabled ?? true },
    ...(basic.additionalKeys ?? []).map((entry) => ({ ...entry, key: entry.key.trim() })),
  ];
}
