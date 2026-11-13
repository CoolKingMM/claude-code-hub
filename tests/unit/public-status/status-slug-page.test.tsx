import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ redirect: vi.fn(), load: vi.fn() }));
vi.mock("@/i18n/routing", () => ({ redirect: mocks.redirect }));
