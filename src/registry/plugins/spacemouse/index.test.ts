import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { engineSceneViewExtensionsValueSpec } from '@src/registry/contracts/engineScene'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { zdsPluginActivationSettingsValueSpec } from '@src/registry/createZdsPlugin'
import { describe, expect, it } from 'vitest'
import spaceMouse from '.'

describe('SpaceMouse plugin', () => {
  it('is off by default under Modeling and contributes controls only while enabled', async () => {
    const registry = new Registry()
    registry.configure([spaceMouse])

    const plugin = registry
      .get(pluginsValueSpec)
      .find((plugin) => plugin.id === 'spacemouse')
    expect(plugin).toBeDefined()

    if (!plugin) {
      throw new Error('Expected SpaceMouse plugin')
    }

    const settings = registry.get(settingsValueSpec)
    expect(settings.modeling.spaceMouse.createSetting().default).toBe(false)
    expect(settings.plugins?.spacemouse).toBeUndefined()
    expect(settings.modeling.spaceMouse.userToml).toMatchObject({
      sectionKey: 'plugins',
      tomlKey: 'spacemouse',
    })
    expect(registry.get(zdsPluginActivationSettingsValueSpec)).toContainEqual(
      expect.objectContaining({
        pluginId: 'spacemouse',
        category: 'modeling',
        settingName: 'spaceMouse',
      })
    )
    expect(registry.get(plugin.service).active.value).toBe(false)
    expect(registry.get(engineSceneViewExtensionsValueSpec)).toEqual([])
    expect(registry.get(statusBarGlobalItemsValueSpec)).toEqual([])

    await registry.get(plugin.service).enable()

    expect(registry.get(plugin.service).active.value).toBe(true)
    expect(
      registry.get(engineSceneViewExtensionsValueSpec).map((item) => item.id)
    ).toEqual(['spacemouse.controller'])
    expect(
      registry.get(statusBarGlobalItemsValueSpec).map((item) => item.id)
    ).toEqual(['spacemouse.status'])

    await registry.get(plugin.service).disable()

    expect(registry.get(plugin.service).active.value).toBe(false)
    expect(registry.get(engineSceneViewExtensionsValueSpec)).toEqual([])
    expect(registry.get(statusBarGlobalItemsValueSpec)).toEqual([])
  })
})
