import "server-only";

import { resolveDefaultSiteMetadataSource } from "@/lib/layout-site-metadata";

export interface PublicSiteMeta {
  siteTitle: string;
  siteDescription: string;
}

export async function readPublicSiteMeta(): Promise<PublicSiteMeta> {
  return resolveDefaultSiteMetadataSource();
}
