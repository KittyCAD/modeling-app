import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { expect, it } from 'vitest'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { zdsPluginActivationSettingsValueSpec } from '@src/registry/createZdsPlugin'
import pyorigami from '@src/registry/plugins/pyorigami'

it('registers the pyOrigami activation setting before the settings machine starts', () => {
  const registry = new Registry()
  try {
    registry.configure([pyorigami])
    // Settings captures contributions synchronously, before feature gates settle.
    expect(
      registry.get(settingsValueSpec).plugins?.pyorigami?.createSetting()
        .default
    ).toBe(false)
    expect(
      registry.get(pluginsValueSpec).some(({ id }) => id === 'pyorigami')
    ).toBe(true)
    expect(registry.get(zdsPluginActivationSettingsValueSpec)).toContainEqual(
      expect.objectContaining({
        pluginId: 'pyorigami',
        category: 'plugins',
        settingName: 'pyorigami',
      })
    )
  } finally {
    registry[Symbol.dispose]()
  }
})
