import { expect, test } from '@e2e/playwright/zoo-test'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'

test.describe('Planar Surface dialog', { tag: '@web' }, () => {
  test.use({
    userFeatures: ['modeling_dialogs', EXPERIMENTAL_POINT_AND_CLICK_FLAG],
  })

  test('creates a surface and edits tolerance while preserving its profile', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const profile = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])`
    const code = `@settings(kclVersion = 3.0)\n${profile}`
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await editor.selectText('region001 = region')
    await toolbar.selectSurface('planar-surface')

    const { locator: dialog, submitButton: submit } = modelingDialog
    const profiles = modelingDialog.selection('Profiles')
    const tolerance = modelingDialog.input(/^tolerance$/i)
    await expect(dialog).toBeVisible()
    await expect(profiles).toContainText(/1 region/i)
    await page.getByRole('button', { name: 'Command help' }).click()
    await expect(page.getByRole('link', { name: 'KCL docs' })).toHaveAttribute(
      'href',
      /std-sketch-planarSurface/
    )
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Clear Profiles selection' }).click()
    await expect(profiles).toHaveText('Select in the scene')
    await expect(submit).toBeDisabled()
    await editor.selectText('region001 = region')
    await expect(profiles).toContainText(/1 region/i)
    await expect(submit).toBeEnabled()
    await scene.waitForExecutionDoneAfter(() => submit.click())
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('surface001 = planarSurface(region001)')

    await toolbar.openFeatureTreePane()
    const operation = await toolbar.getFeatureTreeOperation('surface001', 0)
    await operation.dblclick()
    await expect(tolerance).toBeVisible()
    await expect(profiles).not.toBeAttached()
    await tolerance.fill('0.01mm')
    await expect(submit).toBeEnabled()
    await scene.waitForExecutionDoneAfter(() => submit.click())
    const edited = 'surface001 = planarSurface(region001, tolerance = 0.01mm)'
    await editor.expectEditor.toContain(edited)

    await operation.dblclick()
    await expect(tolerance).toHaveText('0.01mm')
    await tolerance.fill('0.02mm')
    await modelingDialog.cancelButton.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(edited)
    await editor.expectEditor.not.toContain('0.02mm')
    await editor.expectEditor.toContain(profile, { shouldNormalise: true })
  })
})
