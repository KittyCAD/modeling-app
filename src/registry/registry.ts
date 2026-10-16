import { type RegistryItem, Slot } from '@kittycad/registry'
import type { BundledRegistryItemId } from '@src/registry/catalogMetadata'
import { bundledRegistryItemCatalog } from '@src/registry/catalog'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'

export const appRegistryServicesSlot = new Slot()
export const appRegistryOverridesSlot = new Slot()

// Extensions are always-on infrastructure. Plugins retain their existing
// settings-driven activation. Some bundled items are absent for a given build.
export function getRegistryItems(
  ids: readonly BundledRegistryItemId[]
): RegistryItem[] {
  return ids
    .map((id) => bundledRegistryItemCatalog[id])
    .filter((item) => item !== undefined)
}

export const coreRegistryItems = getRegistryItems(defaultRegistryItemIds)
