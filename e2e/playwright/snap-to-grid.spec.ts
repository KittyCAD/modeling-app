import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Snap to Grid', () => {
  test('draws a line with snap to grid turned on', async ({
    page,
    homePage,
    toolbar,
    scene,
    editor,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    // Enter sketch mode and select a default axis from the Feature Tree
    await toolbar.startSketchBtn.click()
    await toolbar.openFeatureTreePane()
    await page.getByRole('button', { name: 'Front plane' }).click()
    await page.waitForTimeout(600)

    // Ensure the line tool is equipped
    await expect(
      page.getByRole('button', { name: 'line Line', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')

    // Toggle Snap to Grid via hotkey (mod+g)
    await page.keyboard.down('ControlOrMeta')
    await page.keyboard.press('g')
    await page.keyboard.up('ControlOrMeta')

    // Draw a line
    const [clickA] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
    const [clickB] = scene.makeMouseHelpers(0.7, 0.3, { format: 'ratio' })

    await page.waitForTimeout(100)
    await clickA()
    await page.waitForTimeout(100)
    await clickB()

    // Check if snapping is working
    await editor.expectEditor.toContain('line(end = [0.15, 0.1])')
  })
})
