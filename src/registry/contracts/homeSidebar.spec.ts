import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import { homeSidebarItemsValueSpec } from '@src/registry/contracts/homeSidebar'
import { describe, expect, it } from 'vitest'

const FirstItem = () => null
const SecondItem = () => null

describe('home sidebar registry contract', () => {
  it('allows extensions to contribute ordered sidebar items', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(homeSidebarItemsValueSpec, {
            id: 'second',
            order: 20,
            Component: SecondItem,
          }),
        ],
      }),
      defineRegistryItem({
        provides: [
          provide(homeSidebarItemsValueSpec, {
            id: 'first',
            order: 10,
            Component: FirstItem,
          }),
        ],
      }),
    ])

    expect(
      registry.get(homeSidebarItemsValueSpec).map((item) => item.id)
    ).toEqual(['first', 'second'])

    registry[Symbol.dispose]()
  })
})
