/**
 * i18n Configuration
 * Defines supported locales and default locale for the application
 */

// Supported locales in the application (Simplified Chinese only)
export const locales = ["zh-CN"] as const;

// TypeScript type for locale
export type Locale = (typeof locales)[number];

// Default locale (Chinese Simplified)
export const defaultLocale: Locale = "zh-CN";

// Locale cookie shared by next-intl middleware and app-level routing helpers
export const localeCookieName = "NEXT_LOCALE";

// Locale labels for language switcher UI
export const localeLabels: Record<Locale, string> = {
  "zh-CN": "简体中文",
};

// Locale names in English (for metadata, SEO)
export const localeNamesInEnglish: Record<Locale, string> = {
  "zh-CN": "Chinese (Simplified)",
};
