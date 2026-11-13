import { getTranslations } from "next-intl/server";
import { getProviders } from "@/actions/providers";
import { Section } from "@/components/section";
import { getSession } from "@/lib/auth";
import { SettingsPageHeader } from "../_components/settings-page-header";
import { AutoSortPriorityDialog } from "./_components/auto-sort-priority-dialog";
import { DispatchSimulatorDialog } from "./_components/dispatch-simulator-dialog";
import { ProviderManagerLoader } from "./_components/provider-manager-loader";
import { ReclusterVendorsDialog } from "./_components/recluster-vendors-dialog";
import { SchedulingRulesDialog } from "./_components/scheduling-rules-dialog";

export const dynamic = "force-dynamic";

export default async function SettingsProvidersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "settings" });
  const session = await getSession();
  const providers = await getProviders();

  return (
    <>
      <SettingsPageHeader title={t("providers.title")} description={t("providers.description")} />

      <Section
        title={t("providers.section.title")}
        description={t("providers.section.description")}
        actions={
          <>
            <AutoSortPriorityDialog />
            <ReclusterVendorsDialog />
            <SchedulingRulesDialog />
            <DispatchSimulatorDialog providers={providers} />
          </>
        }
      >
        <ProviderManagerLoader currentUser={session?.user} />
      </Section>
    </>
  );
}
