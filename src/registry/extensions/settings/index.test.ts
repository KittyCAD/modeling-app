import { statusBarGlobalItemsFacet } from '@src/registry/contracts/statusBar'
import { Registry } from 'plankton'
import type { Location } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import settingsRegistryItem from '.'

describe('settings extension', () => {
  it('contributes the settings status bar item', async () => {
    const registry = new Registry()
    await registry.configure([settingsRegistryItem])
    expect(registry.get(statusBarGlobalItemsFacet)).toEqual([
      expect.objectContaining({
        id: 'settings',
        element: 'link',
        icon: 'settings',
        label: 'Settings',
        'data-testid': 'settings-link',
      }),
    ])
    await registry.dispose()
  })
  it('builds a stable settings link for project file routes', async () => {
    const registry = new Registry()
    await registry.configure([settingsRegistryItem])
    const [settingsItem] = registry.get(statusBarGlobalItemsFacet)

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
    expect(
      settingsItem.href(location('/file/%2Fdocuments%2Fdemo-project'), {
        activeFileRoutePath: filePath,
      })
    ).toBe(`${filePath}/settings?tab=project`)
    await registry.dispose()
  })
})
