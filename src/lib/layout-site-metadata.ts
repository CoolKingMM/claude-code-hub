import { logger } from "@/lib/logger";
import { DEFAULT_SITE_TITLE as FALLBACK_SITE_TITLE } from "@/lib/site-title";

export async function resolveDefaultSiteMetadataSource(): Promise<{
  siteTitle: string;
  siteDescription: string;
}> {
  try {
    const { getCachedSystemSettings } = await import("@/lib/config/system-settings-cache");
    const settings = await getCachedSystemSettings();
    const title = settings.siteTitle?.trim() || FALLBACK_SITE_TITLE;

    return {
      siteTitle: title,
      siteDescription: title,
    };
  } catch (error) {
    logger.warn("resolveDefaultSiteMetadataSource failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      siteTitle: FALLBACK_SITE_TITLE,
      siteDescription: FALLBACK_SITE_TITLE,
    };
  }
}

export async function resolveDefaultLayoutTimeZone(): Promise<string> {
  try {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone");
    return await resolveSystemTimezone();
  } catch (error) {
    logger.warn("resolveDefaultLayoutTimeZone failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return "UTC";
  }
}
