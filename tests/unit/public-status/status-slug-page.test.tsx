import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), load: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/public-status/public-api-loader", () => ({ loadPublicStatusPageData: mocks.load }));

describe("personal deployment public status redirect", () => {
  it.each(["en", "zh-CN", "zh-TW", "ja", "ru"])(
    "keeps %s locale without loading public projections",
    async (locale) => {
      const page = await import("@/app/[locale]/status/[slug]/page");
      await page.default({ params: Promise.resolve({ locale }) });
      expect(mocks.redirect).toHaveBeenCalledWith({ href: "/login", locale });
      expect(mocks.load).not.toHaveBeenCalled();
    }
  );
});
