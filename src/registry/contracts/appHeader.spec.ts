import { appHeaderItemsFacet } from '@src/registry/contracts/appHeader'
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
  it('allows extensions to contribute ordered header items', async () => {
    const registry = new Registry()
    await registry.configure([
      defineFactory({
        create: () => ({
          items: [
            contribute(
              appHeaderItemsFacet,
              () =>
                ({
                  id: 'second',
                  order: 20,
                  Component: SecondItem,
                }) satisfies InputOf<typeof appHeaderItemsFacet>
            ),
          ],
        }),
      }) satisfies Factory,
      defineFactory({
        create: () => ({
          items: [
            contribute(
              appHeaderItemsFacet,
              () =>
                ({
                  id: 'first',
                  order: 10,
                  Component: FirstItem,
                }) satisfies InputOf<typeof appHeaderItemsFacet>
            ),
          ],
        }),
      }) satisfies Factory,
    ])
    expect(registry.get(appHeaderItemsFacet).map((item) => item.id)).toEqual([
      'first',
      'second',
    ])
  })
})
