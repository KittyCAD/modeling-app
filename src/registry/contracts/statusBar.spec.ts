import { Registry, defineRegistryItem, provide } from '@kittycad/registry'
import type { StatusBarItemType } from '@src/components/StatusBar/statusBarTypes'
import {
  filterStatusBarItemsForScopes,
  nullableStatusBarItem,
  statusBarGlobalItemsValueSpec,
  statusBarLocalItemsValueSpec,
} from '@src/registry/contracts/statusBar'
import { describe, expect, it } from 'vitest'

const statusItem = (id: string, order: number): StatusBarItemType => ({
  id,
  order,
  element: 'text',
  label: id,
})

describe('status bar registry contract', () => {
  it('sorts nullable global items after static items, then by order', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(statusBarGlobalItemsValueSpec, statusItem('static-high', 20)),
          provide(
            statusBarGlobalItemsValueSpec,
            nullableStatusBarItem(statusItem('nullable-low', 0))
          ),
          provide(statusBarGlobalItemsValueSpec, statusItem('static-low', 10)),
          provide(
            statusBarGlobalItemsValueSpec,
            nullableStatusBarItem(statusItem('nullable-high', 30))
          ),
        ],
      }),
    ])

    expect(
      registry.get(statusBarGlobalItemsValueSpec).map((item) => item.id)
    ).toEqual(['static-low', 'static-high', 'nullable-low', 'nullable-high'])
  })

  it('sorts nullable local items before static items, then by order', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(statusBarLocalItemsValueSpec, statusItem('static-high', 20)),
          provide(
            statusBarLocalItemsValueSpec,
            nullableStatusBarItem(statusItem('nullable-low', 0))
          ),
          provide(statusBarLocalItemsValueSpec, statusItem('static-low', 10)),
          provide(
            statusBarLocalItemsValueSpec,
            nullableStatusBarItem(statusItem('nullable-high', 30))
          ),
        ],
      }),
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
    ).toEqual(['nullable-low', 'nullable-high', 'static-low', 'static-high'])
  })

  it('omits empty nullable contributions', () => {
    const registry = new Registry()
    registry.configure([
      defineRegistryItem({
        provides: [
          provide(
            statusBarLocalItemsValueSpec,
            nullableStatusBarItem(statusItem('visible', 10))
          ),
          provide(statusBarLocalItemsValueSpec, nullableStatusBarItem(null)),
        ],
      }),
    ])

    expect(
      registry.get(statusBarLocalItemsValueSpec).map((item) => item.id)
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
