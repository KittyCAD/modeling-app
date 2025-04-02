import { getUtils, orRunWhenFullSuiteEnabled } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Test toggling perspective', () => {
  test('via command palette and toggle', async ({ page, homePage }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    const u = await getUtils(page)

    // Locators and constants
    const screenWidth = 1200
    const screenHeight = 500
    const checkedScreenLocation = {
      x: screenWidth * 0.71,
      y: screenHeight * 0.2,
    }
    const backgroundColor: [number, number, number] = [29, 29, 29]
    const xzPlaneColor: [number, number, number] = [82, 55, 96]
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
      await page.setBodyDimensions({ width: screenWidth, height: screenHeight })
      await homePage.goToModelingScene()
      await u.closeKclCodePanel()
      await expect
        .poll(async () => locationToHaveColor(backgroundColor), {
          timeout: 5000,
          message: 'This spot should have the background color',
        })
        .toBeLessThan(15)
      await expect(projectionToggle).toHaveAttribute('aria-checked', 'true')
    })

    // Extremely wild note: flicking between ortho and persp actually changes
    // the orientation of the axis/camera. How can you see this? Well toggle it,
    // then refresh. You'll see it doesn't match what we left.
    await test.step('Switch to ortho via command palette', async () => {
      await commandPaletteButton.click()
      await page.waitForTimeout(1000)
      await commandOption.click()
      await page.waitForTimeout(1000)
      await orthoOption.click()
      await expect(commandToast).toBeVisible()
      await expect(commandToast).not.toBeVisible()
      await expect
        .poll(async () => locationToHaveColor(xzPlaneColor), {
          timeout: 5000,
          message: 'This spot should have the XZ plane color',
        })
        .toBeLessThan(15)
      await expect(projectionToggle).toHaveAttribute('aria-checked', 'false')
    })

    await test.step(`Refresh the page and ensure the stream is loaded in ortho`, async () => {
      await page.reload()
      await page.waitForTimeout(1000)
      await u.closeKclCodePanel()
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
