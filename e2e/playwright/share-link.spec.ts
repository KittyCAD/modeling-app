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

  test(
    'should prefill demo project name on web',
    { tag: ['@web'] },
    async ({ page }) => {
      const code = 'Zm9vYmFyID0gMQ==' // KCL: foobar = 1
      const next = new URL(page.url())
      next.searchParams.set('create-file', 'true')
      next.searchParams.set('name', 'test')
      next.searchParams.set('code', code)
      await page.goto(next.toString())

      const projectTab = page
        .getByTestId('cmd-bar-input-tab')
        .filter({ has: page.getByTestId('arg-name-projectname') })
      await expect(projectTab.getByTestId('header-arg-value')).toHaveText(
        'demo-project'
      )
    }
  )
})
