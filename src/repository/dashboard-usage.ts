import "server-only";

import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, providers, usageLedger } from "@/drizzle/schema";
import type { DashboardUsageQuery, UsageItem, UsageMetrics } from "@/types/dashboard-usage";
import { LEDGER_BILLING_CONDITION } from "./_shared/ledger-conditions";

const channelId = sql`CASE WHEN ${providers.providerVendorId} > 0
  THEN ${providers.providerVendorId}::text || ':' || ${providers.providerType}
  ELSE 'provider:' || ${usageLedger.finalProviderId}::text END`;

function metrics(row: Record<string, unknown>): UsageMetrics {
  return {
    requests: Number(row.requests ?? 0),
    cost: Number(row.cost ?? 0),
    inputTokens: Number(row.inputTokens ?? 0),
    outputTokens: Number(row.outputTokens ?? 0),
    cacheCreationTokens: Number(row.cacheCreationTokens ?? 0),
    cacheReadTokens: Number(row.cacheReadTokens ?? 0),
  };
}

export async function findDashboardUsage(
  query: DashboardUsageQuery,
  range: { startTime: Date; endTime: Date },
  timezone: string,
  userId: number | undefined,
  billingModelSource: "original" | "redirected"
): Promise<{ summary: UsageMetrics; items: UsageItem[]; totalCount: number }> {
  const providerScope = query.scope === "channel" || query.scope === "providerKey";
  const keyScope = query.scope === "key";
  const dimension =
    query.scope === "channel"
      ? channelId
      : query.scope === "providerKey"
        ? sql`'provider:' || ${usageLedger.finalProviderId}::text`
        : keyScope
          ? sql`COALESCE('key:' || key_owner.id::text, 'deleted-key:' || md5(${usageLedger.key}))`
          : query.scope === "day"
            ? sql`to_char(${usageLedger.createdAt} AT TIME ZONE ${timezone}, 'YYYY-MM-DD')`
            : billingModelSource === "original"
              ? sql`COALESCE(${usageLedger.originalModel}, ${usageLedger.model}, '')`
              : sql`COALESCE(${usageLedger.model}, ${usageLedger.originalModel}, '')`;
  const representative = providerScope
    ? sql`${usageLedger.finalProviderId}`
    : keyScope
      ? sql`key_owner.id`
      : sql`NULL::int`;
  const sourceJoin = providerScope
    ? sql`LEFT JOIN ${providers} ON ${providers.id} = ${usageLedger.finalProviderId}`
    : keyScope
      ? sql`LEFT JOIN LATERAL (
          SELECT k.id FROM keys k
          WHERE k.key = ${usageLedger.key} AND k.user_id = ${usageLedger.userId}
          ORDER BY k.deleted_at IS NULL DESC, k.id DESC LIMIT 1
        ) key_owner ON true`
      : sql``;
  const labelJoin =
    query.scope === "channel"
      ? sql`LEFT JOIN LATERAL (
        SELECT p.name, p.provider_type FROM providers p
        WHERE CASE WHEN p.provider_vendor_id > 0
          THEN p.provider_vendor_id::text || ':' || p.provider_type
          ELSE 'provider:' || p.id::text END = g.dimension_id
        ORDER BY p.id LIMIT 1
      ) channel_label ON true`
      : providerScope
        ? sql`LEFT JOIN ${providers} ON ${providers.id} = g.representative_id`
        : keyScope
          ? sql`LEFT JOIN ${keys} ON ${keys.id} = g.representative_id`
          : sql``;
  const label =
    query.scope === "channel"
      ? sql`channel_label.name`
      : providerScope
        ? sql`${providers.name}`
        : keyScope
          ? sql`${keys.name}`
          : sql`NULLIF(g.dimension_id, '')`;
  const type =
    query.scope === "channel"
      ? sql`channel_label.provider_type`
      : providerScope
        ? sql`${providers.providerType}`
        : sql`NULL::text`;
  const pageSize = query.pageSize ?? 20;
  const offset = ((query.page ?? 1) - 1) * pageSize;
  // One ledger aggregation produces both totals and the selected grouping. Only grouped rows
  // enter the materialized CTE; request bodies and credential strings never leave the database.
  const rows = await db.execute(sql`
    WITH grouped AS (
      SELECT dimension_id, MIN(representative_id) AS representative_id,
        GROUPING(dimension_id) = 1 AS is_summary,
        count(*) AS requests, COALESCE(sum(cost_usd), 0) AS cost,
        COALESCE(sum(input_tokens), 0) AS "inputTokens",
        COALESCE(sum(output_tokens), 0) AS "outputTokens",
        COALESCE(sum(cache_creation_input_tokens), 0) AS "cacheCreationTokens",
        COALESCE(sum(cache_read_input_tokens), 0) AS "cacheReadTokens"
      FROM (SELECT ${dimension} AS dimension_id, ${representative} AS representative_id,
        ${usageLedger.costUsd}, ${usageLedger.inputTokens}, ${usageLedger.outputTokens},
        ${usageLedger.cacheCreationInputTokens}, ${usageLedger.cacheReadInputTokens}
        FROM ${usageLedger} ${sourceJoin}
      WHERE ${LEDGER_BILLING_CONDITION}
        AND ${usageLedger.createdAt} >= ${range.startTime.toISOString()}::timestamptz
        AND ${usageLedger.createdAt} < ${range.endTime.toISOString()}::timestamptz
        ${userId === undefined ? sql`` : sql`AND ${usageLedger.userId} = ${userId}`}
        ${query.channelId ? sql`AND ${channelId} = ${query.channelId}` : sql``}
      ) source GROUP BY GROUPING SETS ((dimension_id), ())
    ), page AS (
      SELECT g.dimension_id AS id, ${label} AS name, ${type} AS "providerType",
        g.requests, g.cost, g."inputTokens", g."outputTokens", g."cacheCreationTokens", g."cacheReadTokens"
      FROM grouped g ${labelJoin} WHERE NOT g.is_summary
      ORDER BY ${query.scope === "day" ? sql`g.dimension_id DESC` : sql`g.cost DESC, g.requests DESC, g.dimension_id`}
      LIMIT ${pageSize} OFFSET ${offset}
    )
    SELECT (SELECT row_to_json(g) FROM grouped g WHERE g.is_summary) AS summary,
      (SELECT COALESCE(jsonb_agg(p), '[]'::jsonb) FROM page p) AS items,
      (SELECT count(*) FROM grouped g WHERE NOT g.is_summary) AS total_count
  `);
  const row = Array.from(rows)[0] as {
    summary: Record<string, unknown>;
    items: Array<Record<string, unknown>>;
    total_count: number | string;
  };
  return {
    summary: metrics(row.summary),
    items: row.items.map((item) => ({
      ...metrics(item),
      id: String(item.id),
      name: item.name as string | null,
      providerType: item.providerType as string | null,
    })),
    totalCount: Number(row.total_count),
  };
}
