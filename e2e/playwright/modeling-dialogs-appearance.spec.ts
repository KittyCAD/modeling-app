import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Modeling dialog appearance', { tag: '@desktop' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test('Submits the displayed color without changing the swatch', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    await context.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
extrude001 = extrude(region001, length = 5)`
      )
    })
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await (await toolbar.getFeatureTreeOperation('Extrude', 0)).click({
      button: 'right',
    })
    await page.getByTestId('context-menu-set-appearance').click()

    const dialog = page.getByTestId('modeling-dialog')
    await expect(dialog.getByLabel('Color', { exact: false })).toHaveValue(
      '#ffffff'
    )
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(
      'appearance(extrude001, color = "#ffffff")'
    )
    await scene.settled()
  })
})
