import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import { appHeaderItemsValueSpec } from '@src/registry/contracts/appHeader'
import { describe, expect, it } from 'vitest'

const FirstItem = () => null
const SecondItem = () => null

describe('app header registry contract', () => {
  it('allows extensions to contribute ordered header items', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(appHeaderItemsValueSpec, {
            id: 'second',
            order: 20,
            Component: SecondItem,
          }),
        ],
      }),
      defineRegistryItem({
        provides: [
          provide(appHeaderItemsValueSpec, {
            id: 'first',
            order: 10,
            Component: FirstItem,
          }),
        ],
      }),
    ])

    expect(
      registry.get(appHeaderItemsValueSpec).map((item) => item.id)
    ).toEqual(['first', 'second'])
  })
})
