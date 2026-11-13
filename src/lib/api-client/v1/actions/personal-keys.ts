import type { UserKeyDisplay } from "@/types/user";
import { apiGet, toActionResult } from "./_compat";

export function getPersonalKeyList(userId: number) {
  return toActionResult(
    apiGet<{ items: UserKeyDisplay[] }>(`/api/v1/keys?ownerId=${userId}`).then((body) =>
      body.items.map((key) => ({
        ...key,
        createdAt: new Date(key.createdAt),
        lastUsedAt: key.lastUsedAt ? new Date(key.lastUsedAt) : null,
      }))
    )
  );
}

export function getPersonalKeyModelStats(keyId: number) {
  return toActionResult(
    apiGet<{ items: UserKeyDisplay["modelStats"] }>(`/api/v1/keys/${keyId}/model-stats`).then(
      (body) => body.items
    )
  );
}
