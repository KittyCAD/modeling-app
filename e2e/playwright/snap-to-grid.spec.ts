import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Snap to Grid', { tag: '@desktop' }, () => {
  test('draws a line with snap to grid turned on', async ({
    page,
    homePage,
    toolbar,
    scene,
    editor,
    context,
  }) => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, 'sketch001 = startSketchOn(XZ)')

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    await page.waitForTimeout(1000)

    // Ensure Fixed size grid is ON via Command Bar
    const commands = page.getByRole('button', { name: 'Commands' })
    await commands.click()
    await page
      .getByRole('option', {
        name: 'Settings · modeling · fixed size grid',
      })
      .click()
    await page.getByRole('option', { name: 'On', exact: true }).click()

    // Enter the seeded sketch from the Feature Tree
    const op = await toolbar.getFeatureTreeOperation('sketch001', 0)
    await op.dblclick()
    await toolbar.waitUntilSketchingReady()
    await toolbar.closeFeatureTreePane()

    // Ensure the line tool is equipped
    const lineTool = page.getByRole('button', {
      name: 'line Line',
      exact: true,
    })
    if ((await lineTool.getAttribute('aria-pressed')) !== 'true') {
      await page.keyboard.press('l')
    }
    await expect(lineTool).toHaveAttribute('aria-pressed', 'true')

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
    await editor.expectEditor.toContain('line(end = [5.25, 3.5])')
  })
})
