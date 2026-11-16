import type { UpdateProviderData } from "@/types/provider";

/** API credentials, key switches and key labels remain specific to each record. */
export function getSharedProviderUpdate(data: UpdateProviderData): UpdateProviderData {
  const { name: _name, key: _key, is_enabled: _enabled, ...shared } = data;
  return shared;
}
