"use client";

import { useQuery } from "@tanstack/react-query";
import type { IpGeoLookupResponse } from "@/lib/api/v1/schemas/public";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";

export function useIpGeoLookup(ip: string, lang?: string) {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  return useQuery({
    queryKey: v1Keys.ipGeo.lookup(ip, lang),
    queryFn: () =>
      apiClient.get<IpGeoLookupResponse>(`/api/v1/ip-geo/${encodeURIComponent(ip)}${query}`),
    enabled: ip.length > 0,
  });
}
