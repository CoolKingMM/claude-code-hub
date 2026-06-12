import { getTranslations } from "next-intl/server";
import { getProviders } from "@/actions/providers";
import { Section } from "@/components/section";
import { getSystemSettings } from "@/repository/system-config";
import { SettingsPageHeader } from "../_components/settings-page-header";
import {
  SpecialHandlingForm,
  type SpecialHandlingFormLabels,
} from "./_components/special-handling-form";

export const dynamic = "force-dynamic";

export default async function SpecialHandlingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  await params;
  const t = await getTranslations({ locale: "zh-CN", namespace: "settings" });
  const settings = await getSystemSettings();
  const providers = await getProviders();
  const labels: SpecialHandlingFormLabels = {
    fakeStreaming: {
      title: t("config.form.fakeStreaming.title"),
      description: t("config.form.fakeStreaming.description"),
      emptyState: t("config.form.fakeStreaming.emptyState"),
      providerLabel: t("config.form.fakeStreaming.providerLabel"),
      selectedCount: t.raw("config.form.fakeStreaming.selectedCount") as string,
      selectAll: t("config.form.fakeStreaming.selectAll"),
      clearAll: t("config.form.fakeStreaming.clearAll"),
      noProviders: t("config.form.fakeStreaming.noProviders"),
      providerIdLabel: t("config.form.fakeStreaming.providerIdLabel"),
      groupLabel: t("config.form.fakeStreaming.groupLabel"),
      defaultGroup: t("config.form.fakeStreaming.defaultGroup"),
      enabledStatus: t("config.form.fakeStreaming.enabledStatus"),
      disabledStatus: t("config.form.fakeStreaming.disabledStatus"),
    },
    providerOutputSafety: {
      title: t("config.form.providerOutputSafety.title"),
      description: t("config.form.providerOutputSafety.description"),
      editRules: t("config.form.providerOutputSafety.editRules"),
      rulesLabel: t("config.form.providerOutputSafety.rulesLabel"),
      rulesHint: t("config.form.providerOutputSafety.rulesHint"),
      invalidRule: t.raw("config.form.providerOutputSafety.invalidRule") as string,
      resetToDefault: t("config.form.providerOutputSafety.resetToDefault"),
    },
    saveSettings: t("config.form.saveSettings"),
    saving: t("common.saving"),
    saveFailed: t("config.form.saveFailed"),
    configUpdated: t("config.form.configUpdated"),
  };

  return (
    <>
      <SettingsPageHeader
        title={t("config.specialHandling.title")}
        description={t("config.specialHandling.description")}
        icon="shield-alert"
      />

      <Section
        title={t("config.specialHandling.sectionTitle")}
        description={t("config.specialHandling.sectionDescription")}
        icon="shield-alert"
        iconColor="text-red-400"
        variant="default"
      >
        <SpecialHandlingForm
          initialSettings={{
            fakeStreamingProviderIds: settings.fakeStreamingProviderIds,
            enableProviderOutputSafetyFilter: settings.enableProviderOutputSafetyFilter,
            providerOutputSafetyFilterRules: settings.providerOutputSafetyFilterRules,
          }}
          providers={providers.map((provider) => ({
            id: provider.id,
            name: provider.name,
            groupTag: provider.groupTag,
            providerType: provider.providerType,
            isEnabled: provider.isEnabled,
          }))}
          labels={labels}
        />
      </Section>
    </>
  );
}
