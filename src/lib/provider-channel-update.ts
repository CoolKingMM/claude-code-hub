import type { UpdateProviderData } from "@/types/provider";

/** Credentials, key switches and configuration labels remain specific to each record. */
export function getSharedProviderUpdate(data: UpdateProviderData): UpdateProviderData {
  const {
    name: _name,
    key: _key,
    is_enabled: _enabled,
    new_api_access_token: _accessToken,
    new_api_user_id: _userId,
    ...shared
  } = data;
  return shared;
}
