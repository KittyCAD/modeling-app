import { appHeaderItemsFacet } from '@src/registry/contracts/appHeader'
import {
  extension as defineExtension,
  contribute,
  type InputOf,
  Registry,
  type Extension,
} from 'plankton'
import { describe, expect, it } from 'vitest'

const FirstItem = () => null
const SecondItem = () => null
describe('app header registry contract', () => {
  it('allows extensions to contribute ordered header items', async () => {
    const registry = new Registry()
    await registry.configure([
      defineExtension({
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
      }) satisfies Extension,
      defineExtension({
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
      }) satisfies Extension,
    ])
    expect(registry.get(appHeaderItemsFacet).map((item) => item.id)).toEqual([
      'first',
      'second',
    ])
  })
})
