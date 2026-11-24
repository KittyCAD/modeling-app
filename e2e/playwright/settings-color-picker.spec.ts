import { expect, test } from '@e2e/playwright/zoo-test'

test.use({ mockApiRoutes: false })

test(
  'color picker stays mounted through settings saves and reloads',
  { tag: ['@web', '@localRenderer'] },
  async ({ page, homePage }) => {
    await homePage.projectsLoaded()
    await page.getByTestId('settings-link').click()
    const field = page.getByTestId('backfaceColor')
    const picker = field.locator('input[type="color"]')
    await expect(picker).toBeVisible()
    const originalInput = await picker.elementHandle()
    if (!originalInput) throw new Error('Missing color picker')

    let previousColor = '#ff0000'
    await picker.fill(previousColor)
    for (const color of ['#00ff00', '#0000ff']) {
      await page.waitForFunction(
        (previous) =>
          window.app.settings.actor.getSnapshot().matches('idle') &&
          window.app.settings.get().modeling.backfaceColor.current ===
            previous.toUpperCase(),
        previousColor
      )
      await page.evaluate(async () => {
        const actor = window.app.settings.actor
        await new Promise<void>((resolve) => {
          let reloading = false
          const subscription = actor.subscribe((snapshot) => {
            if (snapshot.matches('reloadingSettings')) reloading = true
            if (reloading && snapshot.matches('idle')) {
              subscription.unsubscribe()
              resolve()
            }
          })
          actor.send({ type: 'reload.settings' })
        })
      })

      await picker.fill(color)
      await expect(
        field.getByText(color.toUpperCase(), { exact: true })
      ).toBeVisible()
      expect(
        await picker.evaluate(
          (input, original) => input === original,
          originalInput
        )
      ).toBe(true)
      await expect(picker).toBeFocused()
      previousColor = color
    }
  }
)
