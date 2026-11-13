import { describe, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => vi.fn());
vi.mock("@/repository/system-config", () => ({ getSystemSettings: settings }));
describe("personal site metadata", () => {
  it("reads the title from system settings without a public projection", async () => {
    settings.mockResolvedValue({ siteTitle: "Personal Hub" });
    const { readPublicSiteMeta } = await import("@/lib/public-site-meta");
    expect(await readPublicSiteMeta()).toEqual({
      siteTitle: "Personal Hub",
      siteDescription: "Personal Hub",
    });
  });
});
