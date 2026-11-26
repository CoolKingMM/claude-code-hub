import { ProxyResponses } from "@/app/v1/_lib/proxy/responses";
import { defaultLocale, type Locale, locales } from "@/i18n/config";

const catalogs: Record<Locale, () => Promise<{ default: { LOCAL_CAPACITY_EXCEEDED: string } }>> = {
  "zh-CN": () => import("../../../messages/zh-CN/errors.json"),
};

export async function buildLocalCapacityResponse(): Promise<Response> {
  let locale: Locale = defaultLocale;
  try {
    const { getLocale } = await import("next-intl/server");
    const requested = await getLocale();
    if (locales.includes(requested as Locale)) locale = requested as Locale;
  } catch {
    /* 无 locale 上下文的网关入口直接使用默认语言目录。 */
  }
  const message = (await catalogs[locale]()).default.LOCAL_CAPACITY_EXCEEDED;
  const response = ProxyResponses.buildError(429, message, "local_capacity_exceeded");
  response.headers.set("retry-after", "1");
  return response;
}
