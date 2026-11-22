import type { BundledRegistryItemId } from '@src/registry/catalogMetadata'

export const APP_STARTUP_COMPOSITION_CHANNEL = 'app:startup-composition'

/** The immutable process-wide selection, read once and shared with every window. */
export interface AppStartupComposition {
  readonly registryItemIds: readonly BundledRegistryItemId[]
}
