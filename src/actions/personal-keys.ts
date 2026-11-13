"use server";

import { getLocale, getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { maskKey } from "@/lib/utils/validation";
import { findKeyById } from "@/repository/key";
import {
  findApiKeyOwners,
  findKeyModelStats,
  findPersonalKeysSummary,
} from "@/repository/personal-keys";
import type { UserDisplay, UserKeyDisplay } from "@/types/user";
import type { ActionResult } from "./types";

export async function getPersonalKeyOwners(): Promise<ActionResult<UserDisplay[]>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Unauthorized", errorCode: "UNAUTHORIZED" };
  const owners = await findApiKeyOwners(
    session.user.role === "admin" ? undefined : session.user.id
  );
  return {
    ok: true,
    data: owners.map((owner) => ({ ...owner, note: owner.description, keys: [] })),
  };
}

export async function getPersonalKeyList(userId: number): Promise<ActionResult<UserKeyDisplay[]>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Unauthorized", errorCode: "UNAUTHORIZED" };
  if (session.user.role !== "admin" && session.user.id !== userId)
    return { ok: false, error: "Forbidden", errorCode: "PERMISSION_DENIED" };
  const [summaries, locale, t] = await Promise.all([
    findPersonalKeysSummary(userId),
    getLocale(),
    getTranslations("users"),
  ]);
  const canReveal = session.user.role === "admin" || session.key.canLoginWebUi;
  return {
    ok: true,
    data: summaries.map(({ key, ...summary }) => ({
      ...summary,
      id: key.id,
      name: key.name,
      maskedKey: maskKey(key.key),
      canReveal,
      canCopy: canReveal,
      expiresAt: key.expiresAt ? key.expiresAt.toISOString().split("T")[0] : t("neverExpires"),
      status: key.isEnabled ? "enabled" : "disabled",
      modelStats: [],
      createdAt: key.createdAt,
      createdAtFormatted: key.createdAt.toLocaleString(locale),
      canLoginWebUi: key.canLoginWebUi,
      limit5hUsd: key.limit5hUsd,
      limit5hResetMode: key.limit5hResetMode,
      limitDailyUsd: key.limitDailyUsd,
      dailyResetMode: key.dailyResetMode,
      dailyResetTime: key.dailyResetTime,
      limitWeeklyUsd: key.limitWeeklyUsd,
      limitMonthlyUsd: key.limitMonthlyUsd,
      limitTotalUsd: key.limitTotalUsd,
      limitConcurrentSessions: key.limitConcurrentSessions,
      costResetAt: key.costResetAt?.toISOString() ?? null,
      providerGroup: key.providerGroup,
    })),
  };
}

export async function getPersonalKeyModelStats(
  keyId: number
): Promise<ActionResult<UserKeyDisplay["modelStats"]>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Unauthorized", errorCode: "UNAUTHORIZED" };
  const key = await findKeyById(keyId);
  if (!key) return { ok: false, error: "Key not found", errorCode: "NOT_FOUND" };
  if (session.user.role !== "admin" && session.user.id !== key.userId)
    return { ok: false, error: "Forbidden", errorCode: "PERMISSION_DENIED" };
  return { ok: true, data: await findKeyModelStats(key.key) };
}
