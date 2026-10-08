import { expect, test } from '@e2e/playwright/zoo-test'

const profileCode = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2mm, var 10mm], center = [var 0mm, var 10mm])
}
region001 = region(segments = [sketch001.circle1])`

test.describe('Modeling dialogs', { tag: '@web' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test('Creates and edits Extrude without losing collapsed fields or selection drafts', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 600 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', profileCode)
    )
    await editor.selectText('region(')
    await toolbar.extrudeButton.click()

    const dialog = page.getByTestId('modeling-dialog')
    const length = dialog.getByRole('textbox', { name: /^length$/i })
    const profiles = dialog.getByRole('button', {
      name: 'Select Profiles',
      exact: true,
    })
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })
    const tagStart = dialog.getByRole('textbox', { name: /^tag start$/i })
    await expect(length).toHaveText('5')
    await expect(tagStart).toBeHidden()
    await expect(
      dialog.getByRole('combobox', { name: /^symmetric$/i })
    ).toBeVisible()
    await expect(profiles).toContainText(/1 region/i)

    await dialog.getByRole('button', { name: 'Select To', exact: true }).click()
    await expect(profiles).toContainText(/1 region/i)
    await profiles.click()
    await expect(profiles).toContainText(/1 region/i)

    await length.fill('missingLength')
    await expect(submit).toBeDisabled()
    await length.fill('12mm')
    await expect(submit).toBeEnabled()
    const more = dialog.getByText('Show more', { exact: true })
    await more.click()
    await expect(submit).toBeInViewport()
    await expect(
      dialog.getByRole('button', { name: 'Cancel' })
    ).toBeInViewport()
    await tagStart.fill('startFace')
    await more.click()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('length = 12mm')
    await editor.expectEditor.toContain('tagStart = $startFace')
    await scene.settled()

    await toolbar.openFeatureTreePane()
    const operation = await toolbar.getFeatureTreeOperation('Extrude', 0)
    await operation.dblclick()
    await expect(length).toHaveText('12mm')
    await expect(tagStart).toBeHidden()
    await more.click()
    await expect(tagStart).toHaveValue('startFace')
    await length.fill('99mm')
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).not.toBeAttached()
    await operation.dblclick()
    await expect(length).toHaveText('12mm')
    await expect(tagStart).toBeHidden()
    await length.fill('8mm')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('length = 8mm')
    await editor.expectEditor.toContain('tagStart = $startFace')
    await editor.expectEditor.not.toContain('99mm')
    await scene.settled()
  })
})
