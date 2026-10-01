/** Provider registry: one server adapter per provider id (swappable in tests). */
import type { AvatarProvider, AvatarProviderId } from "./types";
import { createHeygenLiveAvatarProvider } from "./providers/heygenLiveAvatar";
import { createAnamProvider } from "./providers/anam";
import { createFakeAvatarProvider } from "./providers/fake";

const overrides = new Map<AvatarProviderId, AvatarProvider>();
const instances = new Map<AvatarProviderId, AvatarProvider>();

export function getAvatarProvider(id: AvatarProviderId): AvatarProvider {
  const override = overrides.get(id);
  if (override) return override;
  let instance = instances.get(id);
  if (!instance) {
    instance = id === "heygen_liveavatar" ? createHeygenLiveAvatarProvider()
      : id === "anam" ? createAnamProvider()
      : createFakeAvatarProvider();
    instances.set(id, instance);
  }
  return instance;
}

/** Test seam: replace a provider adapter (pass null to restore the real one). */
export function setAvatarProviderForTesting(id: AvatarProviderId, provider: AvatarProvider | null): void {
  if (provider) overrides.set(id, provider);
  else overrides.delete(id);
}
