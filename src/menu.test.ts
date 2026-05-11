import { beforeEach, describe, expect, it, vi } from 'vitest'

import { setMenuItemEnabled } from '@src/menu'

const { getApplicationMenu } = vi.hoisted(() => ({
  getApplicationMenu: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    name: 'Zoo Design Studio',
  },
  Menu: {
    buildFromTemplate: vi.fn(),
    getApplicationMenu,
    setApplicationMenu: vi.fn(),
  },
}))

describe('setMenuItemEnabled', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('updates the enabled state for an existing menu item', () => {
    const menuItem = { enabled: true }
    const getMenuItemById = vi.fn(() => menuItem)
    const menu = { getMenuItemById }

    setMenuItemEnabled(menu, 'View.Standard views.Reset view', false)

    expect(getMenuItemById).toHaveBeenCalledWith(
      'View.Standard views.Reset view'
    )
    expect(menuItem.enabled).toBe(false)
  })

  it('does nothing when the menu item is not in the current menu', () => {
    const getMenuItemById = vi.fn(() => undefined)
    const menu = { getMenuItemById }

    expect(() =>
      setMenuItemEnabled(menu, 'missing-menu-id', false)
    ).not.toThrow()
    expect(getMenuItemById).toHaveBeenCalledWith('missing-menu-id')
  })
})
