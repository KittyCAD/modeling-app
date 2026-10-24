import type { ElectronPluginContext } from '@src/registry/pluginIpc'
import { bundledElectronPluginRegistrations } from '@src/registry/electronPlugins'
import type { RegistryItem } from '@kittycad/registry'
import { coreRegistryItems } from '@src/registry/registry'
import { describe, expect, it } from 'vitest'

// Frozen migration baseline: the previous glob matches on main. Explicit paths
// let future catalog entries remain opt-in without changing this default.
const legacyModules = import.meta.glob<{
  default?: RegistryItem
  order?: number
}>(
  [
    '../lang/lsp/registry/index.ts',
    '../lib/billing/registry/index.ts',
    '../lib/cursorBlinking/registry/index.ts',
    '../lib/engineConnection/registry/index.ts',
    '../lib/projectLibraries/registry/index.ts',
    '../lib/rustContext/registry/index.ts',
    '../lib/zookeeper/registry/index.ts',
    './extensions/auth/index.ts',
    './extensions/cloudSync/index.ts',
    './extensions/cloudSyncLibrary/index.ts',
    './extensions/commands/index.ts',
    './extensions/engineScene/index.ts',
    './extensions/fileOperations/index.ts',
    './extensions/getDesktopApp/index.ts',
    './extensions/homeProjects/index.ts',
    './extensions/interactionPerformance/index.ts',
    './extensions/keymap/index.ts',
    './extensions/layout/index.ts',
    './extensions/machineManager/index.ts',
    './extensions/markdownEditor/index.ts',
    './extensions/projectExplorer/index.ts',
    './extensions/projectSession/index.ts',
    './extensions/router/index.ts',
    './extensions/runtime/index.ts',
    './extensions/settings/index.ts',
    './extensions/userFeatures/index.ts',
    './extensions/wasm/index.ts',
    './plugins/cloudSync/index.ts',
    './plugins/codeEditor/index.ts',
    './plugins/commandBar/index.ts',
    './plugins/publish/index.ts',
    './plugins/slicer/index.ts',
  ],
  { eager: true }
)

describe('default app composition', () => {
  it('preserves the discovered items and their registration order', () => {
    const legacyItems = Object.entries(legacyModules)
      .map(([path, mod]) => ({
        path,
        kindOrder: path.includes('/plugins/') ? 1 : 0,
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
      .map((entry) => entry.item)

    expect(coreRegistryItems).toHaveLength(legacyItems.length)
    for (const [index, item] of legacyItems.entries()) {
      expect(coreRegistryItems[index]).toBe(item)
    }
  })
})

const legacyElectronModules = import.meta.glob<{
  register: (context: ElectronPluginContext) => void
}>(['./plugins/curaSlicer/electron.ts', './plugins/prusaSlicer/electron.ts'], {
  eager: true,
})

it('preserves Electron plugin registrations and their order', () => {
  const legacyRegistrations = Object.values(legacyElectronModules).map(
    (mod) => mod.register
  )
  expect(bundledElectronPluginRegistrations).toEqual(legacyRegistrations)
})
