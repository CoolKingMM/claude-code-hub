import { z } from "zod";
import { PROVIDER_KEY_MAX_LENGTH } from "@/lib/constants/provider.constants";
import { PROVIDER_KEY_BATCH_MAX } from "@/lib/provider-key-batch";

export const ADDITIONAL_PROVIDER_KEYS_SCHEMA = z
  .array(
    z
      .object({
        key: z.string().trim().min(1).max(PROVIDER_KEY_MAX_LENGTH),
        is_enabled: z.boolean().default(true),
      })
      .strict()
  )
  .max(PROVIDER_KEY_BATCH_MAX - 1)
  .optional();
