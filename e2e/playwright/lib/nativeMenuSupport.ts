import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

export async function clickElectronNativeMenuById(
  tronApp: ElectronZoo,
  menuId: string
) {
  await clickElectronNativeMenuByIdForPage(tronApp, tronApp.page, menuId)
}

export async function clickElectronNativeMenuByIdForPage(
  tronApp: ElectronZoo,
  page: Page,
  menuId: string
) {
  const clickWasTriggered = await triggerElectronNativeMenuByIdForPage(
    tronApp,
    page,
    menuId
  )
  expect(clickWasTriggered).toBe(true)
}

async function triggerElectronNativeMenuByIdForPage(
  tronApp: ElectronZoo,
  page: Page,
  menuId: string
) {
  const browserWindowId = await getElectronBrowserWindowId(tronApp, page)

  return tronApp.electron.evaluate(
    ({ app, BrowserWindow, Menu }, { browserWindowId, menuId }) => {
      type NativeMenuItemForTest = {
        accelerator?: unknown
        click?: (...args: unknown[]) => void
        label?: unknown
      }
      type NativeMenuForTest = {
        getMenuItemById: (
          targetMenuId: string
        ) => NativeMenuItemForTest | null | undefined
      }
      function isObject(value: unknown): value is Record<PropertyKey, unknown> {
        return typeof value === 'object' && value !== null
      }
      function isNativeMenu(value: unknown): value is NativeMenuForTest {
        return isObject(value) && typeof value.getMenuItemById === 'function'
      }
      function getWindowMenuFromTestProperties() {
        const testProperties = Reflect.get(app, 'testProperty')
        if (!isObject(testProperties)) return null

        const nativeWindowMenus = testProperties.nativeWindowMenus
        if (!(nativeWindowMenus instanceof Map)) return null

        return nativeWindowMenus.get(browserWindowId)
      }

      const window = BrowserWindow.fromId(browserWindowId)
      if (!window) return false

      const menu =
        process.platform === 'darwin'
          ? Menu.getApplicationMenu()
          : getWindowMenuFromTestProperties()
      if (!isNativeMenu(menu)) return false

      const menuItem = menu.getMenuItemById(menuId)
      if (typeof menuItem?.click !== 'function') return false

      menuItem.click(menuItem, window, {})
      return true
    },
    { browserWindowId, menuId }
  )
}

async function getElectronBrowserWindowId(tronApp: ElectronZoo, page: Page) {
  const browserWindow = await tronApp.electron.browserWindow(page)
  try {
    return await browserWindow.evaluate((window) => window.id)
  } finally {
    await browserWindow.dispose()
  }
}

export async function findElectronNativeMenuById(
  tronApp: ElectronZoo,
  menuId: string
) {
  await findElectronNativeMenuByIdForPage(tronApp, tronApp.page, menuId)
}

export async function findElectronNativeMenuByIdForPage(
  tronApp: ElectronZoo,
  page: Page,
  menuId: string
) {
  const found = Boolean(
    await getElectronNativeMenuItemByIdForPage(tronApp, page, menuId)
  )
  expect(found).toBe(true)
}

export async function getElectronNativeMenuItemByIdForPage(
  tronApp: ElectronZoo,
  page: Page,
  menuId: string
) {
  const browserWindowId = await getElectronBrowserWindowId(tronApp, page)
  return tronApp.electron.evaluate(
    ({ app, BrowserWindow, Menu }, { browserWindowId, menuId }) => {
      type NativeMenuItemForTest = {
        accelerator?: unknown
        label?: unknown
      }
      type NativeMenuForTest = {
        getMenuItemById: (
          targetMenuId: string
        ) => NativeMenuItemForTest | null | undefined
      }
      function isObject(value: unknown): value is Record<PropertyKey, unknown> {
        return typeof value === 'object' && value !== null
      }
      function isNativeMenu(value: unknown): value is NativeMenuForTest {
        return isObject(value) && typeof value.getMenuItemById === 'function'
      }
      function getWindowMenuFromTestProperties() {
        const testProperties = Reflect.get(app, 'testProperty')
        if (!isObject(testProperties)) return null

        const nativeWindowMenus = testProperties.nativeWindowMenus
        if (!(nativeWindowMenus instanceof Map)) return null

        return nativeWindowMenus.get(browserWindowId)
      }

      const window = BrowserWindow.fromId(browserWindowId)
      if (!window) return null

      const menu =
        process.platform === 'darwin'
          ? Menu.getApplicationMenu()
          : getWindowMenuFromTestProperties()
      if (!isNativeMenu(menu)) return null

      const menuItem = menu.getMenuItemById(menuId)
      if (!menuItem) return null

      return {
        accelerator:
          typeof menuItem.accelerator === 'string'
            ? menuItem.accelerator
            : undefined,
        label: typeof menuItem.label === 'string' ? menuItem.label : '',
      }
    },
    { browserWindowId, menuId }
  )
}
