import { type RegistryItem, Slot } from '@kittycad/registry'

interface FeatureModule {
  default?: RegistryItem
  /** Lower loads earlier. Only needed when a feature must precede its peers. */
  order?: number
}

/**
 * Features are discovered, not listed.
 *
 * A feature is a directory under `features/` whose `index` default-exports a
 * registry item. Nothing has to be added to a central array to install one,
 * which is what keeps the composition root from becoming the file every change
 * touches.
 */
const featureModules: Record<string, FeatureModule> = import.meta.glob(
  ['../features/*/index.ts', '../features/*/index.tsx'],
  { eager: true }
)

/**
 * Where a host can inject or override registry items.
 *
 * Tests replace services through these rather than by mocking modules, and a
 * future desktop build can swap the storage layer without a conditional import.
 */
export const appServicesSlot = new Slot()
export const appOverridesSlot = new Slot()

export const featureRegistryItems: RegistryItem[] = Object.entries(
  featureModules
)
  .map(([path, module]) => ({
    path,
    order: module.order ?? 0,
    item: module.default,
  }))
  .filter(
    (entry): entry is { path: string; order: number; item: RegistryItem } =>
      entry.item !== undefined
  )
  .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
  .map((entry) => entry.item)
