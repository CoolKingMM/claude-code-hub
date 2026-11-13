import { createHash } from "node:crypto";
import { normalizeProviderGroup } from "./utils/provider-group";

/** Group membership is part of vendor identity; tag order and empty/default are equivalent. */
export function scopeProviderVendorKey(baseKey: string, groupTag: unknown): string {
  const groups = normalizeProviderGroup(groupTag);
  if (groups === "default") return baseKey;
  const digest = createHash("sha256").update(`${baseKey}\n${groups}`).digest("hex").slice(0, 32);
  return `${baseKey.slice(0, 215)}#group=${digest}`;
}
