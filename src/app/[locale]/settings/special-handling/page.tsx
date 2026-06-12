import { getTranslations } from "next-intl/server";
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
  const labels: SpecialHandlingFormLabels = {
    fakeStreaming: {
      title: t("config.form.fakeStreaming.title"),
      description: t("config.form.fakeStreaming.description"),
      emptyState: t("config.form.fakeStreaming.emptyState"),
      modelLabel: t("config.form.fakeStreaming.modelLabel"),
      modelPlaceholder: t("config.form.fakeStreaming.modelPlaceholder"),
      groupsLabel: t("config.form.fakeStreaming.groupsLabel"),
      allGroupsHint: t("config.form.fakeStreaming.allGroupsHint"),
      addModel: t("config.form.fakeStreaming.addModel"),
      remove: t("config.form.fakeStreaming.remove"),
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
            fakeStreamingWhitelist: settings.fakeStreamingWhitelist,
            enableProviderOutputSafetyFilter: settings.enableProviderOutputSafetyFilter,
            providerOutputSafetyFilterRules: settings.providerOutputSafetyFilterRules,
          }}
          labels={labels}
        />
      </Section>
    </>
  );
}
