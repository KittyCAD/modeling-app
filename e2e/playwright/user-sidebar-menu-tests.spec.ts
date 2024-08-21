import { test, expect } from '@playwright/test'

import { setupElectron, tearDown } from './test-utils'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Electron user sidebar menu tests', () => {
  test(
    'User settings has correct shortcut',
    { tag: '@electron' },
    async ({ browserName }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async () => {},
      })

      await page.setViewportSize({ width: 1200, height: 500 })

      // Open the user sidebar menu.
      await page.getByTestId('user-sidebar-toggle').click()

      // No space after "User settings" since it's textContent.
      const text =
        process.platform === 'darwin'
          ? 'User settings⌘,'
          : 'User settingsCtrl,'
      const userSettingsButton = page.getByTestId('user-settings')
      await expect(userSettingsButton).toBeVisible()
      await expect(userSettingsButton).toHaveText(text)

      await electronApp.close()
    }
  )
})
