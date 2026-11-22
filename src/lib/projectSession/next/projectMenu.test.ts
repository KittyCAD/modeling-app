import { projectMenuItemsFacet } from '@src/lib/projectSession/next/projectMenu'
import { Registry, contribute } from 'plankton'
import { expect, it } from 'vitest'

it('orders menu actions contributed by independent libraries', async () => {
  const registry = new Registry()
  const Component = () => null
  try {
    await registry.configure([
      contribute(projectMenuItemsFacet, () => ({
        id: 'home',
        order: 1000,
        Component,
      })),
      contribute(projectMenuItemsFacet, () => ({
        id: 'duplicate',
        order: 10,
        Component,
      })),
      contribute(projectMenuItemsFacet, () => ({ id: 'open', Component })),
    ])
    expect(registry.get(projectMenuItemsFacet).map((item) => item.id)).toEqual([
      'open',
      'duplicate',
      'home',
    ])
  } finally {
    await registry.dispose()
  }
})
