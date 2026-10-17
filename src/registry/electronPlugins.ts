import type { BundledRegistryItemId } from '@src/registry/catalogMetadata'
import type { ElectronPluginContext } from '@src/registry/pluginIpc'
import { register as registerCura } from '@src/registry/plugins/curaSlicer/electron'
import { register as registerPrusa } from '@src/registry/plugins/prusaSlicer/electron'
import { SLICER_PLUGIN_ID } from '@src/registry/plugins/slicer/constants'

/** Native entrypoints declare the renderer extension that owns their authority. */
export const bundledElectronPluginCatalog = {
  cura: {
    registryItemId: 'zoo:slicer',
    pluginId: SLICER_PLUGIN_ID,
    register: registerCura,
  },
  prusa: {
    registryItemId: 'zoo:slicer',
    pluginId: SLICER_PLUGIN_ID,
    register: registerPrusa,
  },
} satisfies Record<
  string,
  {
    registryItemId: BundledRegistryItemId
    pluginId: string
    register: (context: ElectronPluginContext) => void
  }
>

export const bundledElectronPluginRegistrations = Object.values(
  bundledElectronPluginCatalog
).map((plugin) => plugin.register)

export function selectElectronPlugins(ids: readonly BundledRegistryItemId[]) {
  return Object.values(bundledElectronPluginCatalog).filter((plugin) =>
    ids.includes(plugin.registryItemId)
  )
}
