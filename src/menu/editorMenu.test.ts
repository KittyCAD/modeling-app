import type { BrowserWindow, MenuItem } from 'electron'
import { expect, it, vi } from 'vitest'
import { editorEditRole } from '@src/menu/editRole'
import { isAppMenuPage } from '@src/menu/windowMenus'
import type { ZooMenuItemConstructorOptions } from '@src/menu/roles'

vi.mock('electron', () => ({
  app: { name: 'Zoo Design Studio' },
  Menu: {},
  BrowserWindow: {},
}))

it.each([
  ['Edit.Undo', 'CmdOrCtrl+Z'],
  ['Edit.Redo', 'Shift+CmdOrCtrl+Z'],
] as const)(
  'dispatches %s to the owning renderer instead of native DOM history',
  (id, accelerator) => {
    const send = vi.fn()
    const owner = { webContents: { send } } as unknown as BrowserWindow
    const submenu = editorEditRole(owner)
      .submenu as ZooMenuItemConstructorOptions[]
    const item = submenu.find((entry) => entry.id === id)!
    expect(item.accelerator).toBe(accelerator)
    expect(item.role).toBeUndefined()
    item.click!({} as MenuItem, owner, {})
    expect(send).toHaveBeenCalledExactlyOnceWith('menu-action-clicked', {
      menuLabel: id,
    })
    expect(isAppMenuPage('editor')).toBe(true)
  }
)
