import { Registry, plugins } from 'plankton'
import { appHeaderEndItemsFacet } from '@src/registry/contracts/appHeader'
import { projectPublicationEnabledFacet } from '@src/registry/contracts/publishing'
import publish from '@src/registry/plugins/publish'
import { expect, it } from 'vitest'

it('owns both the Publish header contribution and Home publication status capability', async () => {
  const registry = new Registry()
  try {
    expect(registry.get(projectPublicationEnabledFacet)).toBe(false)
    await registry.configure([publish])
    const [plugin] = registry.get(plugins)
    const toggle = registry.required(plugin.service)
    expect(registry.get(projectPublicationEnabledFacet)).toBe(true)
    expect(
      registry.get(appHeaderEndItemsFacet).map((item) => item.id)
    ).toContain('publish.open')
    await toggle.disable()
    expect(registry.get(projectPublicationEnabledFacet)).toBe(false)
    expect(registry.get(appHeaderEndItemsFacet)).toEqual([])
    await toggle.enable()
    expect(registry.get(projectPublicationEnabledFacet)).toBe(true)
    await registry.configure([])
    expect(registry.get(projectPublicationEnabledFacet)).toBe(false)
    expect(registry.get(appHeaderEndItemsFacet)).toEqual([])
  } finally {
    await registry.dispose()
  }
})
