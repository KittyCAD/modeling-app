import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { engineSceneOverlayItemsValueSpec } from '@src/registry/contracts/engineScene'
import { settingsValueSpec } from '@src/registry/contracts/settings'
import { viewControlMenuSectionsValueSpec } from '@src/registry/contracts/viewControlMenu'
import { describe, expect, it } from 'vitest'
import spaceMouse from '.'

describe('SpaceMouse plugin', () => {
  it('is off by default and contributes controls only while enabled', () => {
    const registry = new Registry()
    registry.configure([spaceMouse])

    const plugin = registry
      .get(pluginsValueSpec)
      .find((plugin) => plugin.id === 'spacemouse')
    expect(plugin).toBeDefined()

    if (!plugin) {
      throw new Error('Expected SpaceMouse plugin')
    }

    expect(
      registry.get(settingsValueSpec).plugins.spacemouse.createSetting().default
    ).toBe(false)
    expect(registry.get(plugin.service).active.value).toBe(false)
    expect(registry.get(engineSceneOverlayItemsValueSpec)).toEqual([])
    expect(registry.get(viewControlMenuSectionsValueSpec)).toEqual([])

    registry.get(plugin.service).enable()

    expect(registry.get(plugin.service).active.value).toBe(true)
    expect(
      registry.get(engineSceneOverlayItemsValueSpec).map((item) => item.id)
    ).toEqual(['spacemouse.controller'])
    expect(
      registry.get(viewControlMenuSectionsValueSpec).map((item) => item.id)
    ).toEqual(['spacemouse.connect'])

    registry.get(plugin.service).disable()

    expect(registry.get(plugin.service).active.value).toBe(false)
    expect(registry.get(engineSceneOverlayItemsValueSpec)).toEqual([])
    expect(registry.get(viewControlMenuSectionsValueSpec)).toEqual([])
  })
})
