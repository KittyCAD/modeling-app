import { expect, test } from '@e2e/playwright/zoo-test'

const isWindows =
  navigator.platform === 'Windows' || navigator.platform === 'Win32'
test.describe('Share link tests', () => {
  ;[
    {
      codeLength: 1000,
      showsErrorOnWindows: false,
    },
    {
      codeLength: 2000,
      showsErrorOnWindows: true,
    },
  ].forEach(({ codeLength, showsErrorOnWindows }) => {
    test(
      `Open in desktop app with ${codeLength}-long code ${isWindows && showsErrorOnWindows ? 'shows error' : "doesn't show error"}`,
      { tag: ['@web'] },
      async ({ page }) => {
        if (process.env.TARGET !== 'web') {
          // This test is web-only
          // TODO: re-enable on CI as part of a new @web test suite
          return
        }

        const code = Array(codeLength).fill('0').join('')
        const targetURL = `?create-file=true&browser=test&code=${code}&ask-open-desktop=true`
        expect(targetURL.length).toEqual(codeLength + 58)
        await page.goto(page.url() + targetURL)
        expect(page.url()).toContain(targetURL)
        const button = page.getByRole('button', { name: 'Open in desktop app' })
        await button.click()
        const toastError = page.getByText(
          'The URL is too long to open in the desktop app on Windows'
        )
        if (isWindows && showsErrorOnWindows) {
          await expect(toastError).toBeVisible()
        } else {
          await expect(toastError).not.toBeVisible()
          // TODO: check if we could verify the deep link dialog shows up
        }
      }
    )
  })
})
