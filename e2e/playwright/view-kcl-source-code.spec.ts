import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('View KCL source code functionality', () => {
  test.setTimeout(90_000)

  test('@web "View KCL source code" handles edge cases', async ({
    page,
    homePage,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    await u.waitForPageLoad()

    await test.step('Empty scene should have disabled "View KCL source code"', async () => {
      // Right-click in empty scene
      await page.mouse.move(600, 250)
      await page.mouse.down({ button: 'right' })
      await page.mouse.up({ button: 'right' })

      // Verify context menu appears
      await expect(page.getByTestId('view-controls-menu')).toBeVisible()

      // "View KCL source code" should be disabled in empty scene
      const menuItems = page.locator('[data-testid="view-controls-menu"] button')
      const viewKclSourceCodeOption = menuItems.filter({ hasText: 'View KCL source code' })
      await expect(viewKclSourceCodeOption).toBeVisible()
      await expect(viewKclSourceCodeOption).toBeDisabled()
    })

    await test.step('Dragging during right-click should not open context menu', async () => {
      // Click outside to close menu
      await page.mouse.click(100, 100)
      await expect(page.getByTestId('view-controls-menu')).not.toBeVisible()

      // Right-click and drag (should not open context menu)
      await page.mouse.move(600, 250)
      await page.mouse.down({ button: 'right' })
      await page.mouse.move(650, 300)
      await page.mouse.up({ button: 'right' })

      // Context menu should not appear when dragging
      await expect(page.getByTestId('view-controls-menu')).not.toBeVisible()
    })
  })
}) 