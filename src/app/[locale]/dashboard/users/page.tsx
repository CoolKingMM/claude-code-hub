import { getUsers } from "@/actions/users";
import { redirect } from "@/i18n/routing";
import { getSession } from "@/lib/auth";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { ApiKeysPageClient } from "./api-keys-page-client";

export const dynamic = "force-dynamic";

export default async function UsersPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getSession();
  if (!session) return redirect({ href: "/login", locale });
  const [owners, settings] = await Promise.all([getUsers(), getCachedSystemSettings()]);
  return (
    <ApiKeysPageClient
      owners={owners}
      currentUser={session.user}
      currencyCode={settings.currencyDisplay}
    />
  );
}
