import {
  appHeaderStartItemsFacet,
  appHeaderEndItemsFacet,
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
describe.each([
  ['start', appHeaderStartItemsFacet, appHeaderEndItemsFacet],
  ['end', appHeaderEndItemsFacet, appHeaderStartItemsFacet],
])('app header %s zone', (_name, facet, otherFacet) => {
  it('allows extensions to contribute ordered header items', async () => {
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
    expect(registry.get(otherFacet)).toEqual([])
    await registry.dispose()
  })
})
