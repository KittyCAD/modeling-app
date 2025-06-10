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
    `Open in desktop app with 2000-long code doesn't show error on non-Windows`,
    { tag: ['@web', '@macos', '@linux'] },
    async ({ page }) => {
      test.skip(process.platform === 'win32')
      const codeLength = 2000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).not.toBeVisible()
    }
  )

  test(
    `Open in desktop app with 1000-long code works on Windows but not with 2000`,
    { tag: ['@web', '@windows'] },
    async ({ page }) => {
      test.skip(process.platform !== 'win32')
      let codeLength = 1000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).not.toBeVisible()

      codeLength = 2000
      await navigateAndClickOpenInDesktopApp(page, codeLength)
      await expect(getToastError(page)).toBeVisible()
    }
  )
})
