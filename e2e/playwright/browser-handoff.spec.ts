import { expect, test } from '@e2e/playwright/base-test'
import { setup } from '@e2e/playwright/test-utils'
import { devices } from '@playwright/test'
import { getAppFolderName } from '@src/lib/appFolderName'

test(
  'cold handoff starts the app only after Continue and retains link data',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await setup(context, page, testInfo, [], { mockApiRoutes: false })
    const query = new URLSearchParams({
      'ask-open-desktop': 'false',
      'project-id': '',
      code: 'cHJlc2VydmVkID0gMQ==',
      name: 'handoff + link.kcl',
      retained: 'a&b=c',
    })
    await page.goto(`/home?${query}#handoff-fragment`)
    const continuedUrl = new URL(page.url())
    continuedUrl.searchParams.delete('ask-open-desktop')

    const continueButton = page.getByTestId('continue-to-web-app-button')
    await expect(continueButton).toBeEnabled()
    await expect(
      page.getByRole('button', { name: /^Open in desktop app/ })
    ).toBeEnabled()
    await expect(
      page.getByRole('link', { name: /^Download desktop app/ })
    ).toHaveAttribute('href', /\/design-studio\/download(?:\/staging)?$/)
    expect(await page.evaluate(() => typeof window.app)).toBe('undefined')
    expect(
      await page.evaluate(() =>
        performance
          .getEntriesByType('resource')
          .some((resource) => new URL(resource.name).pathname.endsWith('.wasm'))
      )
    ).toBe(false)

    await continueButton.click()
    await expect(page).toHaveURL(continuedUrl.toString())
    await expect(page.getByTestId('home-section')).toBeVisible()
    await expect(continueButton).toHaveCount(0)
    await expect
      .poll(() =>
        page.evaluate(() => window.app.auth.actor.getSnapshot().value)
      )
      .toBe('loggedIn')
  }
)

test(
  'the handoff reads stored appearance without changing settings',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await setup(context, page, testInfo, [], { mockApiRoutes: false })
    await page.goto('/?ask-open-desktop')
    const download = page.getByRole('link', { name: /^Download desktop app/ })
    await expect(download).toHaveAttribute('href', /\/design-studio\/download/)
    const downloadUrl = await download.getAttribute('href')
    if (!downloadUrl) throw new Error('The handoff download link has no URL')
    const folder = getAppFolderName({
      packageName: 'zoo-modeling-app',
      platform: 'unknown',
      isStaging: false,
      // Use the actual browser build's release channel, not the test runner's.
      isStagingOrDebug: new URL(downloadUrl).pathname.endsWith('/staging'),
    })
    await page.goto('/robots.txt')
    const contents = '[settings.app.appearance]\ntheme = "dark"\n'
    await page.evaluate(
      async ({ folder, contents }) => {
        const root = await navigator.storage.getDirectory()
        const appData = await root.getDirectoryHandle('appData', {
          create: true,
        })
        const app = await appData.getDirectoryHandle(folder, { create: true })
        const settings = await app.getFileHandle('settings.toml', {
          create: true,
        })
        const writer = await settings.createWritable()
        await writer.write(contents)
        await writer.close()
      },
      { folder, contents }
    )

    await page.goto('/?ask-open-desktop')
    await expect(page.getByTestId('continue-to-web-app-button')).toBeEnabled()
    await expect(page.locator('body')).toHaveClass(/\bdark\b/)
    expect(await page.evaluate(() => typeof window.app)).toBe('undefined')
    expect(
      await page.evaluate(async (folder) => {
        const root = await navigator.storage.getDirectory()
        const appData = await root.getDirectoryHandle('appData')
        const app = await appData.getDirectoryHandle(folder)
        const settings = await app.getFileHandle('settings.toml')
        return (await settings.getFile()).text()
      }, folder)
    ).toBe(contents)
  }
)

test(
  'an ordinary browser link boots the app without the chooser',
  { tag: '@web' },
  async ({ context, page }, testInfo) => {
    await setup(context, page, testInfo, [], { mockApiRoutes: false })
    await page.goto('/home?retained=ordinary#home')
    await expect(page.getByTestId('home-section')).toBeVisible()
    await expect(page.getByTestId('continue-to-web-app-button')).toHaveCount(0)
    await expect(page).toHaveURL(/\/home\?retained=ordinary#home$/)
    await expect
      .poll(() =>
        page.evaluate(() => window.app.auth.actor.getSnapshot().value)
      )
      .toBe('loggedIn')
  }
)

test.describe('Windows desktop link limit', () => {
  test(
    'an oversized desktop link shows the error without booting the web app',
    { tag: '@web' },
    async ({ browserName, context, page }, testInfo) => {
      test.skip(
        browserName !== 'chromium',
        'The Windows platform contract uses native Chromium platform emulation.'
      )
      const session = await context.newCDPSession(page)
      try {
        await session.send('Emulation.setUserAgentOverride', {
          userAgent: devices['Desktop Edge'].userAgent,
          platform: 'Win32',
        })
        await setup(context, page, testInfo, [], { mockApiRoutes: false })
        await page.goto(`/?ask-open-desktop&code=${'a'.repeat(2046)}`)
        expect(await page.evaluate(() => navigator.platform)).toBe('Win32')
        const url = page.url()
        await page.getByRole('button', { name: /^Open in desktop app/ }).click()
        await expect(
          page.getByText(
            'The URL is too long to open in the desktop app on Windows. Try another platform or use the web app.'
          )
        ).toBeVisible()
        await expect(page).toHaveURL(url)
        await expect(
          page.getByTestId('continue-to-web-app-button')
        ).toBeEnabled()
        expect(await page.evaluate(() => typeof window.app)).toBe('undefined')
      } finally {
        await session.detach()
      }
    }
  )
})
