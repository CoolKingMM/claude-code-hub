export const USAGE_PERIODS = [
  "today",
  "yesterday",
  "last24h",
  "7days",
  "30days",
  "custom",
] as const;
export const USAGE_SCOPES = ["channel", "model", "key", "day", "providerKey"] as const;

export interface DashboardUsageQuery {
  period: (typeof USAGE_PERIODS)[number];
  scope: (typeof USAGE_SCOPES)[number];
  startDate?: string;
  endDate?: string;
  channelId?: string;
  page?: number;
  pageSize?: number;
}

export interface UsageMetrics {
  requests: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface UsageItem extends UsageMetrics {
  id: string;
  name: string | null;
  providerType: string | null;
}

export interface DashboardUsageData {
  summary: UsageMetrics;
  items: UsageItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  startTime: string;
  endTime: string;
  timezone: string;
  generatedAt: string;
}
