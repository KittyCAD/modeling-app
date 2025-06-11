import { expect, test } from '@e2e/playwright/zoo-test'

const isWindows =
  navigator.platform === 'Windows' || navigator.platform === 'Win32'
test.describe('Share link tests', () => {
  test(
    `Open in desktop app with 2000-long code works non-Windows`,
    { tag: ['@web', '@macos', '@linux'] },
    async ({ page }) => {
      test.skip(process.platform === 'win32')
      const codeLength = 2000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).not.toBeVisible()
    }
  )

  test(
    `Open in desktop app with 1000-long code works on Windows`,
    { tag: ['@web', '@windows'] },
    async ({ page }) => {
      test.skip(process.platform !== 'win32')
      const codeLength = 1000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).not.toBeVisible()
    }
  )

  test(
    `Open in desktop app with 2000-long code doesn't work on Windows`,
    { tag: ['@web', '@windows'] },
    async ({ page }) => {
      test.skip(process.platform !== 'win32')
      const codeLength = 2000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).toBeVisible()
    }
  )

})
