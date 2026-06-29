import { Registry } from '@kittycad/registry'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import { describe, expect, it } from 'vitest'
import settingsRegistryItem from '.'

describe('settings extension', () => {
  it('contributes the settings status bar item', () => {
    const registry = new Registry()
    registry.configure([settingsRegistryItem])

    expect(registry.get(statusBarGlobalItemsValueSpec)).toEqual([
      expect.objectContaining({
        id: 'settings',
        element: 'link',
        icon: 'settings',
        label: 'Settings',
        'data-testid': 'settings-link',
      }),
    ])

    registry[Symbol.dispose]()
  })
})
