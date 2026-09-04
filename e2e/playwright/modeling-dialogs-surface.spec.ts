import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Modeling dialog surface output', { tag: '@desktop' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test('Extrudes a closed profile as a surface', async ({
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
region001 = region(segments = [sketch001.circle1])`
      )
    })
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()

    await editor.selectText('region(')
    await toolbar.extrudeButton.click()
    const dialog = page.getByTestId('modeling-dialog')
    await dialog.getByRole('textbox', { name: 'Distance' }).fill('12')
    await dialog.getByRole('button', { name: 'Surface', exact: true }).click()
    await dialog.getByRole('button', { name: 'Submit', exact: true }).click()

    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(
      'extrude(region001, length = 12, bodyType = SURFACE)'
    )
    await scene.settled()
    await expect(
      await toolbar.getFeatureTreeOperation('Extrude', 0)
    ).toBeVisible()
  })
})
