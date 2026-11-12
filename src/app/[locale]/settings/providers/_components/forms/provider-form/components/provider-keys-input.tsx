"use client";

import { Eye, EyeOff, Plus, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { InlineWarning } from "@/components/ui/inline-warning";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { PROVIDER_KEY_BATCH_MAX, type ProviderKeyEntry } from "@/lib/provider-key-batch";
import { detectApiKeyWarnings } from "@/lib/utils/validation/api-key-warnings";

export function ProviderKeysInput({
  entries,
  onChange,
  disabled = false,
  primaryInputId,
}: {
  entries: ProviderKeyEntry[];
  onChange: (entries: ProviderKeyEntry[]) => void;
  disabled?: boolean;
  primaryInputId?: string;
}) {
  const t = useTranslations("settings.providers.form.key");
  const id = useId();
  const [showKeys, setShowKeys] = useState(false);

  const updateEntry = (index: number, patch: Partial<ProviderKeyEntry>) => {
    onChange(entries.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t("multipleDesc")}</p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={showKeys ? t("hide") : t("show")}
          aria-pressed={showKeys}
          onClick={() => setShowKeys(!showKeys)}
        >
          {showKeys ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </Button>
      </div>
      {entries.map((entry, index) => {
        const inputId = index === 0 && primaryInputId ? primaryInputId : `${id}-key-${index}`;
        const enabledId = `${id}-enabled-${index}`;
        const warnings = detectApiKeyWarnings(entry.key);
        return (
          <div key={inputId} className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <Label htmlFor={inputId}>{t("entryLabel", { number: index + 1 })}</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id={enabledId}
                  checked={entry.is_enabled}
                  onCheckedChange={(is_enabled) => updateEntry(index, { is_enabled })}
                  disabled={disabled}
                  aria-label={t("enabledLabel", { number: index + 1 })}
                />
                <Label htmlFor={enabledId} className="text-xs font-normal">
                  {entry.is_enabled ? t("enabled") : t("disabled")}
                </Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled || entries.length === 1}
                  aria-label={t("remove", { number: index + 1 })}
                  onClick={() => onChange(entries.filter((_, i) => i !== index))}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <Input
              id={inputId}
              type={showKeys ? "text" : "password"}
              value={entry.key}
              onChange={(event) => updateEntry(index, { key: event.target.value })}
              placeholder={t("placeholder")}
              disabled={disabled}
              required
              autoComplete="new-password"
              className="font-mono text-sm"
            />
            {warnings.map((warning) => (
              <InlineWarning key={warning}>{t(`warnings.${warning}`)}</InlineWarning>
            ))}
          </div>
        );
      })}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || entries.length >= PROVIDER_KEY_BATCH_MAX}
        onClick={() => onChange([...entries, { key: "", is_enabled: true }])}
      >
        <Plus className="mr-2 h-4 w-4" />
        {t("add")}
      </Button>
      <p className="text-xs text-muted-foreground">{t("limit", { max: PROVIDER_KEY_BATCH_MAX })}</p>
    </div>
  );
}
