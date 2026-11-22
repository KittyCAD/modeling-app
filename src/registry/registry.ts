import { type Extension, slot } from 'plankton'
import type { BundledRegistryItemId } from '@src/registry/catalogMetadata'
import { bundledRegistryItemCatalog } from '@src/registry/catalog'
import { defaultRegistryItemIds } from '@src/registry/defaultComposition'

export const appRegistryOverridesSlot = slot([], Symbol())

// Selection controls registration; plugins retain settings-driven activation.
export function getRegistryItems(
  ids: readonly BundledRegistryItemId[]
): Extension[] {
  return ids
    .map((id) => bundledRegistryItemCatalog[id])
    .filter((item) => item !== undefined)
}

export const coreRegistryItems = getRegistryItems(defaultRegistryItemIds)
