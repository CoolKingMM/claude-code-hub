import { getOverviewData } from "@/actions/overview";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { DashboardModelBreakdown } from "./dashboard-model-breakdown";
import { DashboardOverview } from "./dashboard-overview";

export async function DashboardBentoSection({ isAdmin }: { isAdmin: boolean }) {
  const [settings, overview] = await Promise.all([getCachedSystemSettings(), getOverviewData()]);
  return (
    <DashboardOverview
      isAdmin={isAdmin}
      currencyCode={settings.currencyDisplay}
      initialOverview={overview.ok ? overview.data : undefined}
      modelBreakdown={<DashboardModelBreakdown currencyCode={settings.currencyDisplay} />}
    />
  );
}
