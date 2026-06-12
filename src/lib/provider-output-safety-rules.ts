export const PROVIDER_OUTPUT_SAFETY_REPLACEMENT = "[CCH_FILTERED_DANGEROUS_LOCAL_COMMAND]";

export const PROVIDER_OUTPUT_SAFETY_FILTER_RULE_LIMITS = {
  maxRules: 100,
  maxRuleLength: 1000,
} as const;

export const DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES: readonly string[] = [
  String.raw`\b(?:sudo\s+)?rm\s+(?=[^\r\n]{0,100}(?:-[^\s]*r[^\s]*|--recursive)\b)(?=[^\r\n]{0,100}(?:-[^\s]*f[^\s]*|--force)\b)[^\r\n]{0,160}?\s(?:\/(?:\s|$|[.;,，。])|\/(?:bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|var)(?:\/|\s|$|[.;,，。])|\/\*)`,
  String.raw`\b(?:Remove-Item|rm|del|erase)\s+(?=[^\r\n]{0,140}(?:-Recurse|-r)\b)(?=[^\r\n]{0,140}(?:-Force|-fo)\b)[^\r\n]{0,220}?(?:[a-z]:[\\/]+(?:windows|winnt|system32)(?:[\\/]|$|[.;,，。])|%windir%|%systemroot%|\$env:(?:windir|systemroot))`,
  String.raw`\b(?:sudo\s+)?mkfs(?:\.[a-z0-9]+)?\s+(?:-[^\s]+\s+){0,8}\/dev\/(?:sd[a-z]\d*|vd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|mapper\/[^\s]+)`,
  String.raw`\bdd\s+(?=[^\r\n]{0,160}\bif=\/dev\/(?:zero|random|urandom)\b)(?=[^\r\n]{0,160}\bof=\/dev\/(?:sd[a-z]\d*|vd[a-z]\d*|hd[a-z]\d*|nvme\d+n\d+(?:p\d+)?|mapper\/[^\s]+)\b)[^\r\n]*`,
  String.raw`\bdiskpart\b(?=[^\r\n]{0,240}\bclean\b)[^\r\n]*`,
  String.raw`\bformat(?:\.com)?\s+[a-z]:[^\r\n]*`,
  String.raw`\bbcdedit\s+\/delete\b[^\r\n]*`,
  String.raw`\bbootrec\s+\/(?:fixmbr|fixboot|rebuildbcd)\b[^\r\n]*`,
  String.raw`\bshutdown\s+(?:\/[rs]|-[rhp])\b[^\r\n]*`,
  String.raw`\b(?:sudo\s+)?systemctl\s+(?:reboot|poweroff)\b[^\r\n]*`,
  String.raw`(?:^|[\r\n;|&]|\b(?:run|execute|type|执行|运行|输入)\s+)(?:sudo\s+)?(?:\/sbin\/)?reboot(?:\s+(?:now|--force|-f))?(?=\s|$|[.;,，。])`,
  String.raw`\bRestart-Computer\b[^\r\n]*`,
  String.raw`\b(?:curl|wget)\b(?=[^\r\n]{0,420}\bhttps?:\/\/)(?=[^\r\n]{0,420}(?:\|\s*(?:sudo\s+)?(?:bash|sh|zsh|python3?|perl|ruby|node|pwsh|powershell|cmd)(?:\.exe)?\b|(?:&&|;)\s*(?:sudo\s+)?(?:bash|sh|zsh|python3?|perl|ruby|node|pwsh|powershell|cmd)(?:\.exe)?\b))[^\r\n]*`,
  String.raw`\b(?:iwr|irm|Invoke-WebRequest|Invoke-RestMethod)\b(?=[^\r\n]{0,420}\bhttps?:\/\/)(?=[^\r\n]{0,420}(?:\|\s*(?:iex|Invoke-Expression|powershell|pwsh|cmd)\b|(?:&&|;)\s*(?:powershell|pwsh|cmd)\b))[^\r\n]*`,
  String.raw`\b(?:sudo\s+)?chmod\s+-R\s+777\s+(?:\/(?:\s|$)|\/(?:bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|var)(?:\/|\s|$)|\/\*)[^\r\n]*`,
  String.raw`\b(?:sudo\s+)?chown\s+-R\s+\S+\s+(?:\/(?:\s|$)|\/(?:bin|boot|dev|etc|lib|lib64|proc|root|sbin|sys|usr|var)(?:\/|\s|$)|\/\*)[^\r\n]*`,
];

export function normalizeProviderOutputSafetyFilterRules(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_PROVIDER_OUTPUT_SAFETY_FILTER_RULES];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const rule = item.trim();
    if (!rule || seen.has(rule)) continue;
    seen.add(rule);
    normalized.push(rule);
  }
  return normalized;
}

export function validateProviderOutputSafetyFilterRule(rule: string): string | null {
  if (rule.length > PROVIDER_OUTPUT_SAFETY_FILTER_RULE_LIMITS.maxRuleLength) {
    return "rule is too long";
  }

  try {
    new RegExp(rule, "giu");
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

export function compileProviderOutputSafetyFilterRules(rules: readonly string[]): RegExp[] {
  const compiled: RegExp[] = [];
  for (const rule of rules) {
    if (validateProviderOutputSafetyFilterRule(rule) !== null) continue;
    compiled.push(new RegExp(rule, "giu"));
  }
  return compiled;
}
