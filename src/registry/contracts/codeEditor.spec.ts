import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import { codeEditorHeaderItemsValueSpec } from '@src/registry/contracts/codeEditor'
import { describe, expect, it } from 'vitest'

const FirstItem = () => null
const SecondItem = () => null

describe('code editor registry contract', () => {
  it('allows extensions to contribute ordered header items', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(codeEditorHeaderItemsValueSpec, {
            id: 'second',
            order: 20,
            Component: SecondItem,
          }),
        ],
      }),
      defineRegistryItem({
        provides: [
          provide(codeEditorHeaderItemsValueSpec, {
            id: 'first',
            order: 10,
            Component: FirstItem,
          }),
        ],
      }),
    ])

    expect(
      registry.get(codeEditorHeaderItemsValueSpec).map((item) => item.id)
    ).toEqual(['first', 'second'])
  })
})
