import { type RegistryItem, Slot } from '@kittycad/registry'

type RegistryItemModule = {
  default?: RegistryItem
  order?: number
}

const bundledRegistryItemModules: Record<string, RegistryItemModule> =
  import.meta.glob(
    [
      './extensions/*/index.ts',
      './plugins/*/index.ts',
      '../lib/*/registry/index.ts',
      '../lang/*/registry/index.ts',
    ],
    {
      eager: true,
    }
  )

export const appRegistryServicesSlot = new Slot()
export const appRegistryOverridesSlot = new Slot()

const bundledRegistryItemKindOrder = (path: string) =>
  path.includes('/plugins/') ? 1 : 0

// Core app registry items discovered from the glob patterns in `bundledRegistryItemModules`.
//
// Extensions are always-on app infrastructure. Plugins are user-visible,
// runtime-toggleable bundles that may depend on extension contracts.
export const coreRegistryItems: RegistryItem[] = Object.entries(
  bundledRegistryItemModules
)
  .map(([path, mod]) => ({
    path,
    kindOrder: bundledRegistryItemKindOrder(path),
    order: mod.order ?? 0,
    item: mod.default,
  }))
  .filter((entry) => entry.item !== undefined)
  .sort(
    (a, b) =>
      a.kindOrder - b.kindOrder ||
      a.order - b.order ||
      a.path.localeCompare(b.path)
  )
  .map((entry) => entry.item as RegistryItem)
