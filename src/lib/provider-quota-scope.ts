/**
 * 多协议逻辑渠道共享限额与并发作用域工具。
 *
 * - 单协议独立渠道（protocolGroupId 为空）：保持原有数字 provider.id，Redis key 与 SQL 零变化。
 * - 多协议逻辑渠道（protocolGroupId 非空）：统一映射到 `pg_<protocolGroupId>`，
 *   让同组所有协议共享 5h/daily/weekly/monthly/total 预算与并发 Session 上限。
 */

export type ProviderQuotaScopeId = number | string;

export const PROTOCOL_GROUP_SCOPE_PREFIX = "pg_";

const PROTOCOL_GROUP_ID_PATTERN = /^[A-Za-z0-9-]+$/;

export function getProviderQuotaScopeId(provider: {
  id: number;
  protocolGroupId?: string | null;
}): ProviderQuotaScopeId {
  const groupId = provider.protocolGroupId?.trim();
  return groupId ? `${PROTOCOL_GROUP_SCOPE_PREFIX}${groupId}` : provider.id;
}

export function extractProtocolGroupIdFromScope(scopeId: ProviderQuotaScopeId): string | null {
  if (typeof scopeId !== "string") {
    return null;
  }
  if (!scopeId.startsWith(PROTOCOL_GROUP_SCOPE_PREFIX)) {
    return null;
  }
  const groupId = scopeId.slice(PROTOCOL_GROUP_SCOPE_PREFIX.length);
  if (!groupId || !PROTOCOL_GROUP_ID_PATTERN.test(groupId)) {
    return null;
  }
  return groupId;
}

export function isValidProviderQuotaScopeId(scopeId: ProviderQuotaScopeId): boolean {
  if (typeof scopeId === "number") {
    return Number.isInteger(scopeId) && scopeId > 0;
  }
  return extractProtocolGroupIdFromScope(scopeId) !== null;
}
