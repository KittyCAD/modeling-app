import { test, expect } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import { TEST_SETTINGS, TEST_SETTINGS_KEY } from './storageStates'
import * as TOML from '@iarna/toml'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Test toggling perspective', () => {
  test('via command palette and toggle', async ({ page }) => {
    const u = await getUtils(page)

    // Locators and constants
    const screenWidth = 1200
    const screenHeight = 500
    const checkedScreenLocation = {
      x: screenWidth * 0.71,
      y: screenHeight * 0.4,
    }
    const backgroundColor: [number, number, number] = [29, 29, 29]
    const xzPlaneColor: [number, number, number] = [50, 50, 99]
    const locationToHaveColor = async (color: [number, number, number]) => {
      return u.getGreatestPixDiff(checkedScreenLocation, color)
    }
    const commandPaletteButton = page.getByRole('button', { name: 'Commands' })
    const commandOption = page.getByRole('option', {
      name: 'camera projection',
    })
    const orthoOption = page.getByRole('option', { name: 'orthographic' })
    const commandToast = page.getByText(
      `Set camera projection to "orthographic"`
    )
    const projectionToggle = page.getByRole('switch', {
      name: 'Camera projection: ',
    })

    await test.step('Setup', async () => {
      await page.setViewportSize({ width: screenWidth, height: screenHeight })
      await u.waitForAuthSkipAppStart()
      await u.closeKclCodePanel()
      await expect
        .poll(async () => locationToHaveColor(backgroundColor), {
          timeout: 5000,
          message: 'This spot should have the background color',
        })
        .toBeLessThan(15)
      await expect(projectionToggle).toHaveAttribute('aria-checked', 'true')
    })

    await test.step('Switch to ortho via command palette', async () => {
      await commandPaletteButton.click()
      await commandOption.click()
      await orthoOption.click()
      await expect(commandToast).toBeVisible()
      await expect
        .poll(async () => locationToHaveColor(xzPlaneColor), {
          timeout: 5000,
          message: 'This spot should have the XZ plane color',
        })
        .toBeLessThan(15)
      await expect(projectionToggle).toHaveAttribute('aria-checked', 'false')
    })

    await test.step(`Refresh the page and ensure the stream is loaded in ortho`, async () => {
      // In playwright web, the settings set while testing are not persisted because
      // the `addInitScript` within `setup` is re-run on page reload
      await page.addInitScript(
        ({ settingsKey, settings }) => {
          localStorage.setItem(settingsKey, settings)
        },
        {
          settingsKey: TEST_SETTINGS_KEY,
          settings: TOML.stringify({
            settings: {
              ...TEST_SETTINGS,
              modeling: {
                ...TEST_SETTINGS.modeling,
                cameraProjection: 'orthographic',
              },
            },
          }),
        }
      )
      await page.reload()
      await u.waitForAuthSkipAppStart()
      await expect
        .poll(async () => locationToHaveColor(xzPlaneColor), {
          timeout: 5000,
          message: 'This spot should have the XZ plane color',
        })
        .toBeLessThan(15)
      await expect(commandToast).not.toBeVisible()
      await expect(projectionToggle).toHaveAttribute('aria-checked', 'false')
    })

    await test.step(`Switch to perspective via toggle`, async () => {
      await projectionToggle.click()
      await expect(projectionToggle).toHaveAttribute('aria-checked', 'true')
      await expect
        .poll(async () => locationToHaveColor(backgroundColor), {
          timeout: 5000,
          message: 'This spot should have the background color',
        })
        .toBeLessThan(15)
    })
  })
})
