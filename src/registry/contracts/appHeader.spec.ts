import { appHeaderItemsFacet } from '@src/registry/contracts/appHeader'
import { contribute, type InputOf, Registry, type Subtree } from 'plankton'
import { describe, expect, it } from 'vitest'

const FirstItem = () => null
const SecondItem = () => null
describe('app header registry contract', () => {
  it('allows extensions to contribute ordered header items', async () => {
    const registry = new Registry()
    await registry.configure([
      {
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
      } satisfies Subtree,
      {
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
      } satisfies Subtree,
    ])
    expect(registry.get(appHeaderItemsFacet).map((item) => item.id)).toEqual([
      'first',
      'second',
    ])
  })
})
