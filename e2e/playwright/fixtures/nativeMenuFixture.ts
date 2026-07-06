import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'

import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'

type NativeMenuAction = 'click' | 'getItem'

type NativeMenuItemSnapshot = {
  accelerator: string | undefined
  label: string
}

type NativeMenuActionResult = boolean | NativeMenuItemSnapshot | null

function throwTronAppMissing(): never {
  throw new Error('tronApp is missing.')
}

export class NativeMenuFixture {
  constructor(private readonly tronApp: ElectronZoo | undefined) {}

  async click(menuId: string, page = this.requiredTronApp.page) {
    const clickWasTriggered = await this.runNativeMenuAction(
      page,
      menuId,
      'click'
    )
    expect(clickWasTriggered).toBe(true)
  }

  async find(menuId: string, page = this.requiredTronApp.page) {
    const found = Boolean(await this.getItem(menuId, page))
    expect(found).toBe(true)
  }

  async getItem(menuId: string, page = this.requiredTronApp.page) {
    return this.runNativeMenuAction(page, menuId, 'getItem')
  }

  async openNewWindow(page = this.requiredTronApp.page) {
    const newWindowPromise =
      this.requiredTronApp.electron.waitForEvent('window')
    await page.evaluate(() => {
      if (!window.electron) {
        throw new Error('Electron is not available')
      }

      window.electron.openInNewWindow('')
    })

    const newWindow = await newWindowPromise
    await newWindow.waitForLoadState('domcontentloaded')
    return newWindow
  }

  private get requiredTronApp() {
    return this.tronApp ?? throwTronAppMissing()
  }

  private async runNativeMenuAction(
    page: Page,
    menuId: string,
    action: 'click'
  ): Promise<boolean>
  private async runNativeMenuAction(
    page: Page,
    menuId: string,
    action: 'getItem'
  ): Promise<NativeMenuItemSnapshot | null>
  private async runNativeMenuAction(
    page: Page,
    menuId: string,
    action: NativeMenuAction
  ): Promise<NativeMenuActionResult> {
    const browserWindowId = await this.getBrowserWindowId(page)

    return this.requiredTronApp.electron.evaluate(
      ({ app }, { action, browserWindowId, menuId }) => {
        const testProperties = Reflect.get(app, 'testProperty')
        if (typeof testProperties !== 'object' || testProperties === null) {
          return action === 'click' ? false : null
        }

        const nativeMenu = Reflect.get(testProperties, 'nativeMenu')
        if (typeof nativeMenu !== 'object' || nativeMenu === null) {
          return action === 'click' ? false : null
        }

        const methodName =
          action === 'click' ? 'clickMenuItemForWindow' : 'getMenuItemForWindow'
        const method = Reflect.get(nativeMenu, methodName)
        if (typeof method !== 'function') {
          return action === 'click' ? false : null
        }

        return method(browserWindowId, menuId)
      },
      { action, browserWindowId, menuId }
    )
  }

  private async getBrowserWindowId(page: Page) {
    const browserWindow =
      await this.requiredTronApp.electron.browserWindow(page)
    try {
      return await browserWindow.evaluate((window) => window.id)
    } finally {
      await browserWindow.dispose()
    }
  }
}
