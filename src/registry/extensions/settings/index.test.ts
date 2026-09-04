import { Registry } from '@kittycad/registry'
import { statusBarGlobalItemsValueSpec } from '@src/registry/contracts/statusBar'
import type { Location } from 'react-router-dom'
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

  it('builds a stable settings link for project file routes', () => {
    const registry = new Registry()
    registry.configure([settingsRegistryItem])
    const [settingsItem] = registry.get(statusBarGlobalItemsValueSpec)

    if (
      !settingsItem ||
      'component' in settingsItem ||
      settingsItem.element !== 'link' ||
      typeof settingsItem.href !== 'function'
    ) {
      throw new Error('Expected the settings item to provide a link function')
    }

    const filePath = '/file/%2Fdocuments%2Fdemo-project%2Fmain.kcl'
    const location = (pathname: string) => ({ pathname }) as Location

    expect(settingsItem.href(location(filePath))).toBe(
      `${filePath}/settings?tab=project`
    )
    expect(settingsItem.href(location(`${filePath}/settings`))).toBe(
      `${filePath}/settings?tab=project`
    )

    registry[Symbol.dispose]()
  })
})
