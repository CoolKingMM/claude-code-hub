import { getPersonalKeyList, getPersonalKeyOwners } from "@/actions/personal-keys";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { ApiKeysPageClient } from "./api-keys-page-client";

export const dynamic = "force-dynamic";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) return redirect({ href: "/login", locale });
  const [owners, settings] = await Promise.all([getPersonalKeyOwners(), getCachedSystemSettings()]);
  const ownerList = owners.ok ? owners.data : [];
  const keys = ownerList[0] ? await getPersonalKeyList(ownerList[0].id) : null;
  if (ownerList[0] && keys?.ok) ownerList[0].keys = keys.data;
  return (
    <ApiKeysPageClient
      owners={ownerList}
      currentUser={session.user}
      currencyCode={settings.currencyDisplay}
    />
  );
}
