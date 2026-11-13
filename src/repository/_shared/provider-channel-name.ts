import { sql } from "drizzle-orm";
import { providers } from "@/drizzle/schema";

/** Match the channel name used in the provider list, without changing credential IDs. */
export const providerChannelName = sql<string | null>`COALESCE((
  SELECT channel_provider.name FROM providers channel_provider
  WHERE channel_provider.provider_vendor_id = ${providers.providerVendorId}
    AND channel_provider.provider_type = ${providers.providerType}
    AND channel_provider.deleted_at IS NULL
  ORDER BY channel_provider.id LIMIT 1
), ${providers.name})`;
