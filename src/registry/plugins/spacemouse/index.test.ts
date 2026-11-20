import { engineSceneViewExtensionsFacet } from '@src/registry/contracts/engineScene'
import { settingsFacet } from '@src/registry/contracts/settings'
import { statusBarGlobalItemsFacet } from '@src/registry/contracts/statusBar'
import { zdsPluginActivationSettingsFacet } from '@src/registry/createZdsPlugin'
import { Registry, plugins } from 'plankton'
import { describe, expect, it } from 'vitest'
import spaceMouse from '.'

describe('SpaceMouse plugin', () => {
  it('is off by default under Modeling and contributes controls only while enabled', async () => {
    const registry = new Registry()
    await registry.configure([spaceMouse])

    const plugin = registry
      .get(plugins)
      .find((plugin) => plugin.id === 'spacemouse')
    expect(plugin).toBeDefined()

    if (!plugin) {
      throw new Error('Expected SpaceMouse plugin')
    }

    const toggle = registry.required(plugin.service)
    const settings = registry.get(settingsFacet)
    expect(settings.modeling.spaceMouse.createSetting().default).toBe(false)
    expect(settings.plugins?.spacemouse).toBeUndefined()
    expect(settings.modeling.spaceMouse.userToml).toMatchObject({
      sectionKey: 'plugins',
      tomlKey: 'spacemouse',
    })
    expect(registry.get(zdsPluginActivationSettingsFacet)).toContainEqual(
      expect.objectContaining({
        pluginId: 'spacemouse',
        category: 'modeling',
        settingName: 'spaceMouse',
      })
    )
    expect(toggle.active.value).toBe(false)
    expect(registry.get(engineSceneViewExtensionsFacet)).toEqual([])
    expect(registry.get(statusBarGlobalItemsFacet)).toEqual([])

    await toggle.enable()

    expect(toggle.active.value).toBe(true)
    expect(
      registry.get(engineSceneViewExtensionsFacet).map((item) => item.id)
    ).toEqual(['spacemouse.controller'])
    expect(
      registry.get(statusBarGlobalItemsFacet).map((item) => item.id)
    ).toEqual(['spacemouse.status'])

    await toggle.disable()

    expect(toggle.active.value).toBe(false)
    expect(registry.get(engineSceneViewExtensionsFacet)).toEqual([])
    expect(registry.get(statusBarGlobalItemsFacet)).toEqual([])
    await registry.dispose()
  })
})
