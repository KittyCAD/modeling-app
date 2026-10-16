import { Registry, pluginsValueSpec } from '@kittycad/registry'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { projectPublicationEnabledValueSpec } from '@src/registry/contracts/publishing'
import publish from '@src/registry/plugins/publish'
import { expect, it } from 'vitest'

it('owns both the Publish header contribution and Home publication status capability', async () => {
  const registry = new Registry()
  try {
    expect(registry.get(projectPublicationEnabledValueSpec)).toBe(false)
    registry.configure([publish])
    const [plugin] = registry.get(pluginsValueSpec)
    const toggle = registry.get(plugin.service)
    expect(registry.get(projectPublicationEnabledValueSpec)).toBe(true)
    expect(
      registry.get(appHeaderItemsValueSpec).map((item) => item.id)
    ).toContain('publish.open')
    await toggle.disable()
    expect(registry.get(projectPublicationEnabledValueSpec)).toBe(false)
    expect(registry.get(appHeaderItemsValueSpec)).toEqual([])
    await toggle.enable()
    expect(registry.get(projectPublicationEnabledValueSpec)).toBe(true)
    registry.configure([])
    expect(registry.get(projectPublicationEnabledValueSpec)).toBe(false)
    expect(registry.get(appHeaderItemsValueSpec)).toEqual([])
  } finally {
    await registry.disposeAsync()
  }
})
