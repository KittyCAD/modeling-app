import type { ExtensionNode } from '@kittycad/extensions'

type PluginModule = {
  default?: ExtensionNode
  order?: number
}

const pluginModules: Record<string, PluginModule> = import.meta.glob(
  './plugins/*/index.ts',
  {
    eager: true,
  }
)

// Core app plugins discovered from src/extensions/plugins/*/index.ts.
// Keep ordering deterministic so adding folders does not create unstable load order.
export const coreExtensions: ExtensionNode[] = Object.entries(pluginModules)
  .map(([path, mod]) => ({
    path,
    order: mod.order ?? 0,
    plugin: mod.default,
  }))
  .filter((entry) => entry.plugin !== undefined)
  .sort((a, b) => a.order - b.order || a.path.localeCompare(b.path))
  .map((entry) => entry.plugin as ExtensionNode)
