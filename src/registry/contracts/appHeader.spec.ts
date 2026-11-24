import {
  appHeaderItemsFacet,
  appHeaderLeftItemsFacet,
} from '@src/registry/contracts/appHeader'
import {
  factory as defineFactory,
  contribute,
  type InputOf,
  Registry,
  type Factory,
} from 'plankton'
import { describe, expect, it } from 'vitest'

const FirstItem = () => null
const SecondItem = () => null
describe('app header registry contract', () => {
  it.each([
    ['right', appHeaderItemsFacet],
    ['left', appHeaderLeftItemsFacet],
  ] as const)(
    'allows extensions to contribute ordered %s header items',
    async (_, facet) => {
      const registry = new Registry()
      await registry.configure([
        defineFactory({
          create: () => ({
            items: [
              contribute(
                facet,
                () =>
                  ({
                    id: 'second',
                    order: 20,
                    Component: SecondItem,
                  }) satisfies InputOf<typeof facet>
              ),
            ],
          }),
        }) satisfies Factory,
        defineFactory({
          create: () => ({
            items: [
              contribute(
                facet,
                () =>
                  ({
                    id: 'first',
                    order: 10,
                    Component: FirstItem,
                  }) satisfies InputOf<typeof facet>
              ),
            ],
          }),
        }) satisfies Factory,
      ])
      expect(registry.get(facet).map((item) => item.id)).toEqual([
        'first',
        'second',
      ])
    }
  )
})
