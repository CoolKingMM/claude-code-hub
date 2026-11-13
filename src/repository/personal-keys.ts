import "server-only";

import { and, asc, count, eq, gte, inArray, isNull, lt, sql, sum } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { usageLedger, users } from "@/drizzle/schema";
import type { User } from "@/types/user";
import { LEDGER_BILLING_CONDITION } from "./_shared/ledger-conditions";
import { toUser } from "./_shared/transformers";
import { findKeyList } from "./key";

export async function findApiKeyOwners(userId?: number): Promise<User[]> {
  const rows = await db
    .select()
    .from(users)
    .where(and(isNull(users.deletedAt), userId === undefined ? undefined : eq(users.id, userId)))
    .orderBy(asc(users.id));
  return rows.map(toUser);
}

export async function findPersonalKeysSummary(userId: number) {
  const keyList = await findKeyList(userId);
  if (keyList.length === 0) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const keyStrings = keyList.map((key) => key.key);
  const [usageRows, lastRows] = await Promise.all([
    db
      .select({
        key: usageLedger.key,
        calls: count(),
        cost: sum(usageLedger.costUsd),
        tokens: sql<number>`COALESCE(SUM(COALESCE(${usageLedger.inputTokens}, 0)::double precision + COALESCE(${usageLedger.outputTokens}, 0)::double precision + COALESCE(${usageLedger.cacheCreationInputTokens}, 0)::double precision + COALESCE(${usageLedger.cacheReadInputTokens}, 0)::double precision), 0)`,
      })
      .from(usageLedger)
      .where(
        and(
          inArray(usageLedger.key, keyStrings),
          LEDGER_BILLING_CONDITION,
          gte(usageLedger.createdAt, today),
          lt(usageLedger.createdAt, tomorrow)
        )
      )
      .groupBy(usageLedger.key),
    db.execute(sql`SELECT k.key_val AS key, lr.created_at, p.name AS provider_name
      FROM unnest(ARRAY[${sql.join(
        keyStrings.map((key) => sql`${key}`),
        sql`, `
      )}]::varchar[]) AS k(key_val)
      LEFT JOIN LATERAL (SELECT ul.created_at, ul.final_provider_id FROM usage_ledger ul WHERE ul.key = k.key_val AND ul.blocked_by IS NULL AND ul.is_replay = false ORDER BY ul.created_at DESC LIMIT 1) lr ON true
      LEFT JOIN providers p ON lr.final_provider_id = p.id`),
  ]);
  const usage = new Map(usageRows.map((row) => [row.key, row]));
  const last = new Map(
    Array.from(
      lastRows as Iterable<{ key: string; created_at: Date | null; provider_name: string | null }>
    ).map((row) => [row.key, row])
  );
  return keyList.map((key) => ({
    key,
    todayCallCount: Number(usage.get(key.key)?.calls ?? 0),
    todayUsage: Number(usage.get(key.key)?.cost ?? 0),
    todayTokens: Number(usage.get(key.key)?.tokens ?? 0),
    lastUsedAt: last.get(key.key)?.created_at ?? null,
    lastProviderName: last.get(key.key)?.provider_name ?? null,
  }));
}

export async function findKeyModelStats(keyString: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return db
    .select({
      model: sql<string>`${usageLedger.model}`,
      callCount: sql<number>`count(*)::int`,
      totalCost: sql<number>`COALESCE(sum(${usageLedger.costUsd}), 0)::double precision`,
      inputTokens: sql<number>`COALESCE(sum(${usageLedger.inputTokens}), 0)::double precision`,
      outputTokens: sql<number>`COALESCE(sum(${usageLedger.outputTokens}), 0)::double precision`,
      cacheCreationTokens: sql<number>`COALESCE(sum(${usageLedger.cacheCreationInputTokens}), 0)::double precision`,
      cacheReadTokens: sql<number>`COALESCE(sum(${usageLedger.cacheReadInputTokens}), 0)::double precision`,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.key, keyString),
        LEDGER_BILLING_CONDITION,
        gte(usageLedger.createdAt, today),
        lt(usageLedger.createdAt, tomorrow),
        sql`${usageLedger.model} IS NOT NULL`
      )
    )
    .groupBy(usageLedger.model);
}
