const TOKEN_UNIT_K = 1_000;
const TOKEN_UNIT_M = 1_000_000;
const TOKEN_UNIT_B = 1_000_000_000;
const TOKEN_UNIT_T = 1_000_000_000_000;

const NUMBER_FORMAT_OPTIONS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
};

function formatNumber(value: number): string {
  return value.toLocaleString(undefined, NUMBER_FORMAT_OPTIONS);
}

function appendUnit(value: number, divisor: number, unit: string): string {
  const scaled = value / divisor;
  return `${formatNumber(scaled)}${unit}`;
}

/**
 * 统一的 Token / 大数值紧凑格式化函数
 * - 小于 1,000 显示原值
 * - 1,000 ~ 999,999 显示 K（保留最多 2 位小数）
 * - 1,000,000 ~ 999,999,999 显示 M（保留最多 2 位小数）
 * - 1,000,000,000 ~ 999,999,999,999 显示 B（保留最多 2 位小数）
 * - >= 1,000,000,000,000 显示 T（保留最多 2 位小数）
 * - 空值返回 "-"
 */
export function formatTokenAmount(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "-";
  }

  const absolute = Math.abs(value);

  if (absolute < TOKEN_UNIT_K) {
    return formatNumber(value);
  }

  if (absolute < TOKEN_UNIT_M) {
    return appendUnit(value, TOKEN_UNIT_K, "K");
  }

  if (absolute < TOKEN_UNIT_B) {
    return appendUnit(value, TOKEN_UNIT_M, "M");
  }

  if (absolute < TOKEN_UNIT_T) {
    return appendUnit(value, TOKEN_UNIT_B, "B");
  }

  return appendUnit(value, TOKEN_UNIT_T, "T");
}
