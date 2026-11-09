import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import {
  filterStatusBarItemsForScopes,
  nullableStatusBarItem,
  statusBarGlobalItemsFacet,
  statusBarLocalItemsFacet,
} from '@src/registry/contracts/statusBar'
import { contribute, Registry, type Subtree } from 'plankton'
import { describe, expect, it } from 'vitest'

const statusItem = (id: string, order: number): StatusBarItemType => ({
  id,
  order,
  element: 'text',
  label: id,
})

describe('status bar registry contract', () => {
  it('sorts nullable global items after static items, then by order', async () => {
    const registry = new Registry()
    await registry.configure([
      {
        create: () => ({
          items: [
            contribute(statusBarGlobalItemsFacet, () =>
              statusItem('static-high', 20)
            ),
            contribute(statusBarGlobalItemsFacet, () =>
              nullableStatusBarItem(statusItem('nullable-low', 0))
            ),
            contribute(statusBarGlobalItemsFacet, () =>
              statusItem('static-low', 10)
            ),
            contribute(statusBarGlobalItemsFacet, () =>
              nullableStatusBarItem(statusItem('nullable-high', 30))
            ),
          ],
        }),
      } satisfies Subtree,
    ])

    expect(
      registry.get(statusBarGlobalItemsFacet).map((item) => item.id)
    ).toEqual(['static-low', 'static-high', 'nullable-low', 'nullable-high'])
  })
  it('sorts nullable local items before static items, then by order', async () => {
    const registry = new Registry()
    await registry.configure([
      {
        create: () => ({
          items: [
            contribute(statusBarLocalItemsFacet, () =>
              statusItem('static-high', 20)
            ),
            contribute(statusBarLocalItemsFacet, () =>
              nullableStatusBarItem(statusItem('nullable-low', 0))
            ),
            contribute(statusBarLocalItemsFacet, () =>
              statusItem('static-low', 10)
            ),
            contribute(statusBarLocalItemsFacet, () =>
              nullableStatusBarItem(statusItem('nullable-high', 30))
            ),
          ],
        }),
      } satisfies Subtree,
    ])

    expect(
      registry.get(statusBarLocalItemsFacet).map((item) => item.id)
    ).toEqual(['nullable-low', 'nullable-high', 'static-low', 'static-high'])
  })
  it('omits empty nullable contributions', async () => {
    const registry = new Registry()
    await registry.configure([
      {
        create: () => ({
          items: [
            contribute(statusBarLocalItemsFacet, () =>
              nullableStatusBarItem(statusItem('visible', 10))
            ),
            contribute(statusBarLocalItemsFacet, () =>
              nullableStatusBarItem(null)
            ),
          ],
        }),
      } satisfies Subtree,
    ])

    expect(
      registry.get(statusBarLocalItemsFacet).map((item) => item.id)
    ).toEqual(['visible'])
  })

  it('filters scoped status bar items while keeping unscoped items', () => {
    expect(
      filterStatusBarItemsForScopes(
        [
          statusItem('unscoped', 0),
          { ...statusItem('home', 0), scopes: ['home'] },
          { ...statusItem('file', 0), scopes: ['file'] },
          { ...statusItem('both', 0), scopes: ['home', 'file'] },
        ],
        ['home']
      ).map((item) => item.id)
    ).toEqual(['unscoped', 'home', 'both'])
  })
})
