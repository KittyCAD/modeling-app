import { Slot, type RegistryItem } from '@kittycad/registry'

type PluginModule = {
  default?: RegistryItem
  order?: number
}

const pluginModules: Record<string, PluginModule> = import.meta.glob(
  './plugins/*/index.ts',
  {
    eager: true,
  }
)

export const appRegistryServicesSlot = new Slot()

// Core app plugins discovered from src/registry/plugins/*/index.ts.
// Keep ordering deterministic so adding folders does not create unstable load order.
export const coreRegistryItems: RegistryItem[] = Object.entries(pluginModules)
  .map(([path, mod]) => ({
    path,
    order: mod.order ?? 0,
    plugin: mod.default,
  }))
  .filter((entry) => entry.plugin !== undefined)
  .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
  .map((entry) => entry.plugin as RegistryItem)
