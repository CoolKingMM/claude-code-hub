"use client";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Edit, Globe } from "lucide-react";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { TooltipProvider } from "@/components/ui/tooltip";
import { getProviderVendors } from "@/lib/api-client/v1/actions/provider-endpoints";
import { getProviderTypeTranslationKey } from "@/lib/provider-type-utils";
import { groupProvidersByVendor } from "@/lib/provider-vendor-groups";
import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import type { ProviderDisplay, ProviderStatisticsMap } from "@/types/provider";
import type { User } from "@/types/user";
import type { EndpointCircuitInfoMap } from "./provider-manager";
import { ProviderRichListItem } from "./provider-rich-list-item";

// Stable default references to avoid re-creating on every render (defeats React.memo)
const EMPTY_STRING_ARRAY: string[] = [];
const EMPTY_OBJECT: Record<string, never> = {};
const EMPTY_SET = new Set<number>();

interface ProviderListProps {
  providers: ProviderDisplay[];
  /** Full list keeps vendor identity and key numbering stable while filtering. */
  allProviders?: ProviderDisplay[];
  currentUser?: User;
  healthStatus: Record<
    number,
    {
      circuitState: "closed" | "open" | "half-open";
      failureCount: number;
      lastFailureTime: number | null;
      circuitOpenUntil: number | null;
      recoveryMinutes: number | null;
    }
  >;
  /** Endpoint-level circuit breaker info, keyed by provider ID */
  endpointCircuitInfo?: EndpointCircuitInfoMap;
  statistics?: ProviderStatisticsMap;
  statisticsLoading?: boolean;
  currencyCode?: CurrencyCode;
  enableMultiProviderTypes: boolean;
  activeGroupFilter?: string | null;
  isMultiSelectMode?: boolean;
  selectedProviderIds?: Set<number>;
  onSelectProvider?: (providerId: number, checked: boolean) => void;
  onEditProvider?: (provider: ProviderDisplay) => void;
  allGroups?: string[];
  userGroups?: string[];
  isAdmin?: boolean;
}

export function ProviderList({
  providers,
  allProviders = providers,
  currentUser,
  healthStatus,
  endpointCircuitInfo = EMPTY_OBJECT,
  statistics = EMPTY_OBJECT,
  statisticsLoading = false,
  currencyCode = "USD",
  enableMultiProviderTypes,
  activeGroupFilter = null,
  isMultiSelectMode = false,
  selectedProviderIds = EMPTY_SET,
  onSelectProvider,
  onEditProvider,
  allGroups = EMPTY_STRING_ARRAY,
  userGroups = EMPTY_STRING_ARRAY,
  isAdmin = false,
}: ProviderListProps) {
  const t = useTranslations("settings.providers");

  const { data: vendors = [] } = useQuery({
    queryKey: ["provider-vendors"],
    queryFn: getProviderVendors,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const vendorById = useMemo(() => {
    return new Map(vendors.map((vendor) => [vendor.id, vendor]));
  }, [vendors]);
  const groups = useMemo(() => groupProvidersByVendor(providers), [providers]);
  const allGroupsByVendor = useMemo(
    () =>
      new Map(
        groupProvidersByVendor(allProviders).map(({ vendorId, providers: keys }) => [
          vendorId,
          keys.toSorted((left, right) => left.id - right.id),
        ])
      ),
    [allProviders]
  );

  const renderKey = (provider: ProviderDisplay, displayName?: string) => (
    <ProviderRichListItem
      key={provider.id}
      provider={provider}
      displayName={displayName}
      vendor={provider.providerVendorId ? vendorById.get(provider.providerVendorId) : undefined}
      currentUser={currentUser}
      healthStatus={healthStatus[provider.id]}
      endpointCircuitInfo={endpointCircuitInfo[provider.id]}
      statistics={statistics[provider.id]}
      statisticsLoading={statisticsLoading}
      currencyCode={currencyCode}
      enableMultiProviderTypes={enableMultiProviderTypes}
      activeGroupFilter={activeGroupFilter}
      isMultiSelectMode={isMultiSelectMode}
      isSelected={selectedProviderIds.has(provider.id)}
      onSelectChange={
        onSelectProvider ? (checked) => onSelectProvider(provider.id, checked) : undefined
      }
      onEdit={onEditProvider ? () => onEditProvider(provider) : undefined}
      allGroups={allGroups}
      userGroups={userGroups}
      isAdmin={isAdmin}
    />
  );

  if (providers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 px-4">
        <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
          <Globe className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="font-medium text-foreground mb-1">{t("noProviders")}</h3>
        <p className="text-sm text-muted-foreground text-center">{t("noProvidersDesc")}</p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="grid gap-3 md:block md:border md:rounded-lg md:overflow-hidden md:gap-0">
        {groups.map(({ vendorId, providers: keys }) => {
          const allKeys = allGroupsByVendor.get(vendorId) ?? keys;
          if (allKeys.length === 1) return renderKey(keys[0]);
          const primary = allKeys[0];
          return (
            <ProviderListVendorGroup
              key={vendorId}
              vendorId={vendorId}
              primary={primary}
              providers={keys}
              totalKeys={allKeys.length}
              statistics={statistics}
              statisticsLoading={statisticsLoading}
              currencyCode={currencyCode}
              isMultiSelectMode={isMultiSelectMode}
              selectedProviderIds={selectedProviderIds}
              onSelectProvider={onSelectProvider}
              onEdit={
                currentUser?.role === "admin" && onEditProvider
                  ? () => onEditProvider(primary)
                  : undefined
              }
            >
              {keys.map((provider) =>
                renderKey(
                  provider,
                  t("vendorListKeyLabel", {
                    index: allKeys.findIndex((key) => key.id === provider.id) + 1,
                  })
                )
              )}
            </ProviderListVendorGroup>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

function ProviderListVendorGroup({
  vendorId,
  primary,
  providers,
  totalKeys,
  statistics,
  statisticsLoading,
  currencyCode,
  isMultiSelectMode,
  selectedProviderIds,
  onSelectProvider,
  onEdit,
  children,
}: {
  vendorId: number;
  primary: ProviderDisplay;
  providers: ProviderDisplay[];
  totalKeys: number;
  statistics: ProviderStatisticsMap;
  statisticsLoading: boolean;
  currencyCode: CurrencyCode;
  isMultiSelectMode: boolean;
  selectedProviderIds: Set<number>;
  onSelectProvider?: (providerId: number, checked: boolean) => void;
  onEdit?: () => void;
  children: ReactNode;
}) {
  const t = useTranslations("settings.providers");
  const tTypes = useTranslations("settings.providers.types");
  const tList = useTranslations("settings.providers.list");
  const [expanded, setExpanded] = useState(false);
  const selectedCount = providers.filter((provider) => selectedProviderIds.has(provider.id)).length;
  const enabledCount = providers.filter((provider) => provider.isEnabled).length;
  const todayCalls = providers.reduce(
    (sum, provider) => sum + (statistics[provider.id]?.todayCalls ?? provider.todayCallCount ?? 0),
    0
  );
  const todayCost = providers.reduce(
    (sum, provider) =>
      sum + parseFloat(statistics[provider.id]?.todayCost ?? provider.todayTotalCostUsd ?? "0"),
    0
  );

  return (
    <Collapsible
      open={expanded}
      onOpenChange={setExpanded}
      className="rounded-lg border bg-card md:rounded-none md:border-0 md:border-b"
      data-testid={`provider-list-vendor-${vendorId}`}
    >
      <div className="flex flex-wrap items-center gap-3 border-l-[3px] border-l-primary p-4 md:py-3">
        {isMultiSelectMode && (
          <Checkbox
            checked={
              selectedCount === providers.length
                ? true
                : selectedCount > 0
                  ? "indeterminate"
                  : false
            }
            onCheckedChange={(checked) => {
              for (const provider of providers) onSelectProvider?.(provider.id, Boolean(checked));
            }}
            aria-label={t("vendorSelectKeys", { name: primary.name })}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{primary.name}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {providers.length === totalKeys
                ? `${totalKeys} ${t("vendorKeys")}`
                : t("vendorFilteredKeys", { visible: providers.length, total: totalKeys })}
              {" · "}
              {t("vendorEnabledKeys", { count: enabledCount })}
            </span>
            {[...new Set(providers.map((provider) => provider.providerType))].map((type) => (
              <Badge key={type} variant="outline" className="text-xs">
                {tTypes(`${getProviderTypeTranslationKey(type)}.label`)}
              </Badge>
            ))}
          </div>
        </div>
        <div className="hidden text-right text-xs tabular-nums lg:block">
          {statisticsLoading ? (
            tList("keyLoading")
          ) : (
            <>
              <p>{tList("todayUsageCount", { count: todayCalls })}</p>
              <p className="font-mono text-muted-foreground">
                {formatCurrency(todayCost, currencyCode)}
              </p>
            </>
          )}
        </div>
        {onEdit && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onEdit}
            aria-label={t("editProvider")}
          >
            <Edit className="h-4 w-4" />
          </Button>
        )}
        <CollapsibleTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label={t(expanded ? "collapseVendorKeys" : "expandVendorKeys", {
              name: primary.name,
            })}
          >
            {t("manageVendorKeys")}
            <ChevronDown className={`ml-2 h-4 w-4 ${expanded ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-2 bg-muted/20 p-2 md:space-y-0 md:p-0 md:pl-6">
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}
