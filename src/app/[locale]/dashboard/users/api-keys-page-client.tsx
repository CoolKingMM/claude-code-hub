"use client";

import { Plus, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createUserOnly } from "@/lib/api-client/v1/actions/users";
import type { CurrencyCode } from "@/lib/utils/currency";
import type { User, UserDisplay } from "@/types/user";
import { AddKeyDialog } from "../_components/user/add-key-dialog";
import { KeyList } from "../_components/user/key-list";

export function toKeyOwner(owner: UserDisplay): User {
  return {
    ...owner,
    description: owner.note ?? "",
    providerGroup: owner.providerGroup ?? "default",
    createdAt: new Date(0),
    updatedAt: new Date(0),
    limit5hUsd: owner.limit5hUsd ?? undefined,
    limit5hResetMode: owner.limit5hResetMode ?? "rolling",
    limitWeeklyUsd: owner.limitWeeklyUsd ?? undefined,
    limitMonthlyUsd: owner.limitMonthlyUsd ?? undefined,
    limitConcurrentSessions: owner.limitConcurrentSessions ?? undefined,
    dailyResetMode: owner.dailyResetMode ?? "fixed",
    dailyResetTime: owner.dailyResetTime ?? "00:00",
  };
}

interface ApiKeysPageClientProps {
  owners: UserDisplay[];
  currentUser: User;
  currencyCode: CurrencyCode;
}

export function ApiKeysPageClient({ owners, currentUser, currencyCode }: ApiKeysPageClientProps) {
  const t = useTranslations("dashboard.apiKeys");
  const tAdd = useTranslations("dashboard.addKeyForm");
  const tCommon = useTranslations("common");
  const router = useRouter();
  const [openAdd, setOpenAdd] = useState(false);
  const [ownerId, setOwnerId] = useState<number | null>(null);
  const [pending, startTransition] = useTransition();
  const visibleOwners =
    currentUser.role === "admin" ? owners : owners.filter((owner) => owner.id === currentUser.id);
  const activeOwner = visibleOwners.find((owner) => owner.id === ownerId) ?? visibleOwners[0];

  const handleAdd = () => {
    if (activeOwner) {
      setOpenAdd(true);
      return;
    }
    if (currentUser.role !== "admin") return;
    startTransition(async () => {
      try {
        const result = await createUserOnly({ name: t("defaultOwner"), providerGroup: "default" });
        if (!result.ok) {
          toast.error(result.error || tCommon("error"));
          return;
        }
        router.refresh();
      } catch {
        toast.error(tCommon("error"));
      }
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            aria-label={t("refresh")}
            onClick={() => router.refresh()}
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button
            onClick={handleAdd}
            disabled={pending || (!activeOwner && currentUser.role !== "admin")}
          >
            <Plus className="mr-2 h-4 w-4" />
            {activeOwner ? tAdd("title") : t("initialize")}
          </Button>
        </div>
      </div>
      {visibleOwners.length > 1 && (
        <Select
          value={String(activeOwner?.id)}
          onValueChange={(value) => setOwnerId(Number(value))}
        >
          <SelectTrigger className="w-64" aria-label={t("owner")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {visibleOwners.map((owner) => (
              <SelectItem key={owner.id} value={String(owner.id)}>
                {owner.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <div className="rounded-xl border bg-card p-4">
        <KeyList
          keys={activeOwner?.keys ?? []}
          currentUser={currentUser}
          keyOwnerUserId={activeOwner?.id ?? 0}
          keyOwnerUser={activeOwner ? toKeyOwner(activeOwner) : undefined}
          currencyCode={currencyCode}
        />
      </div>
      {activeOwner && (
        <AddKeyDialog
          open={openAdd}
          onOpenChange={setOpenAdd}
          userId={activeOwner.id}
          user={toKeyOwner(activeOwner)}
          isAdmin={currentUser.role === "admin"}
        />
      )}
    </div>
  );
}
