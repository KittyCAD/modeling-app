import { expect, test } from '@e2e/playwright/zoo-test'
import { throwTronAppMissing } from '@e2e/playwright/lib/electron-helpers'

test.use({ mockApiRoutes: false })

test(
  'browser bootstrap reaches authenticated Home without opening an editor',
  { tag: '@web' },
  async ({ page }) => {
    await expect(page.getByTestId('home-section')).toBeVisible()
    expect(
      await page.evaluate(() => window.app.auth.actor.getSnapshot().value)
    ).toBe('loggedIn')
    expect(await page.evaluate(() => window.app.project)).toBeUndefined()
  }
)

test(
  'native fixture reloads return with the current app and settings ready',
  { tag: '@desktop' },
  async ({ page, tronApp, folderSetupFn, fs }) => {
    if (!tronApp) throwTronAppMissing()
    const renderer = await page.context().newCDPSession(page)
    // Exercise the real asynchronous bootstrap on a slower renderer, as in CI.
    await renderer.send('Emulation.setCPUThrottlingRate', { rate: 6 })
    try {
      await tronApp.cleanProjectDir()
      expect(
        await page.evaluate(
          () =>
            window.app.settings.actor.getSnapshot().context.modeling.defaultUnit
              .current
        )
      ).toBe('in')
      expect(
        await page.evaluate(
          () => window.app.engineCommandManager === window.engineCommandManager
        )
      ).toBe(true)

      await folderSetupFn(async (directory) => {
        await fs.mkdir(await fs.join(directory, 'fixture-ready'), {
          recursive: true,
        })
      })
      expect(
        await page.evaluate(
          () =>
            window.app.settings.actor.getSnapshot().context.modeling.defaultUnit
              .current
        )
      ).toBe('in')
      await expect(page.getByTestId('home-section')).toBeVisible()
    } finally {
      await renderer.send('Emulation.setCPUThrottlingRate', { rate: 1 })
      await renderer.detach()
    }
  }
)
