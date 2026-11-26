/**
 * i18n Request Configuration
 * Configures how translations are loaded for each request
 */

import { getRequestConfig } from "next-intl/server";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type { Locale } from "./config";
import { routing } from "./routing";

export default getRequestConfig(async () => {
  const locale: Locale = routing.defaultLocale;
  const messages = await import("../../messages/zh-CN").then((module) => module.default);

  const timeZone = await resolveSystemTimezone();

  return {
    locale,
    messages,
    timeZone,
    now: new Date(),
    // Optional: Enable runtime warnings for missing translations in development
    onError:
      process.env.NODE_ENV === "development"
        ? (error) => {
            console.error("i18n error:", error);
          }
        : undefined,
    // Optional: Configure what happens when a translation is missing
    getMessageFallback: ({ namespace, key }) => {
      return `${namespace}.${key}`;
    },
  };
});
