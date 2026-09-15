import { expect, test } from '@e2e/playwright/zoo-test'

test.use({ userFeatures: [] })

const DELETE_BODY_CODE = `@settings(kclVersion = 2.0)

profile = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
body = extrude(region(sketch = profile, point = profile.circle1.center), length = 10mm)
keptBody = clone(body)
  |> translate(x = 15mm)
`

for (const entryPoint of ['Bodies pane', 'toolbar']) {
  test(`Delete a body from the ${entryPoint} without experimental features`, async ({
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
    page,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await editor.codeContent.fill(DELETE_BODY_CODE)
    await scene.settled()
    await toolbar.openFeatureTreePane()

    const bodiesPane = page.locator('#bodies-list-pane')
    const bodyRows = bodiesPane.getByRole('button', { name: /^Body \d+$/ })
    await expect(bodyRows).toHaveCount(2)
    const body = bodiesPane.getByRole('button', { name: 'Body 1', exact: true })

    if (entryPoint === 'Bodies pane') {
      await body.click({ button: 'right' })
      await page.getByTestId('context-menu-delete').click()
    } else {
      await toolbar.selectTransform('delete')
      await expect(page.getByTestId('command-name')).toHaveText('Delete')
      await body.click()
      await cmdBar.continue()
      await cmdBar.submit()
    }

    await scene.settled()
    await expect(bodyRows).toHaveCount(1)
    await editor.expectEditor.toContain('delete(body)')
    await editor.expectEditor.toContain('body = extrude(')
    await editor.expectEditor.toContain('keptBody = clone(body)')
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
    await expect(page.locator('.cm-lint-marker-warning')).not.toBeVisible()

    await page.keyboard.press('ControlOrMeta+z')
    await scene.settled()
    await expect(bodyRows).toHaveCount(2)
    await editor.expectEditor.not.toContain('delete(body)')
  })
}
