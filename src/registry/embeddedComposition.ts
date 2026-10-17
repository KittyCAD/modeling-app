import { defaultRegistryItemIds } from '@src/registry/defaultComposition'
import type { AppStartupComposition } from '@src/registry/startupComposition'

/** Vite embeds the selected IDs; unbundled consumers and tests use the default. */
export function getEmbeddedAppComposition(): AppStartupComposition {
  return typeof __APP_STARTUP_COMPOSITION__ === 'undefined'
    ? { registryItemIds: [...defaultRegistryItemIds] }
    : __APP_STARTUP_COMPOSITION__
}
