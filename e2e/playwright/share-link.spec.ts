import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'

async function navigateAndClickOpenInDesktopApp(
  page: Page,
  codeLength: number
) {
  const code = Array(codeLength).fill('0').join('')
  const targetURL = `?create-file=true&browser=test&code=${code}&ask-open-desktop=true`
  expect(targetURL.length).toEqual(codeLength + 58)
  await page.goto(page.url() + targetURL)
  expect(page.url()).toContain(targetURL)
  const button = page.getByRole('button', { name: 'Open in desktop app' })
  await button.click()
}

function getToastError(page: Page) {
  return page.getByText('The URL is too long to open in the desktop app')
}

test.describe('Share link tests', () => {
  test(
    `Open in desktop app with 2000-long code doesn't show error on macOS`,
    { tag: ['@web', '@macos'] },
    async ({ page }) => {
      test.skip(process.platform === 'win32' || process.platform === 'linux')
      const codeLength = 2000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).not.toBeVisible()
    }
  )

  test(
    `Open in desktop app with 1000-long code works on Windows and Linux but not with 2000`,
    { tag: ['@web', '@windows', '@linux'] },
    async ({ page }) => {
      test.skip(process.platform === 'darwin')
      let codeLength = 1000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).not.toBeVisible()

      codeLength = 2000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).toBeVisible()
    }
  )
})
