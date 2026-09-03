import { expect, test } from '@e2e/playwright/zoo-test'

const profileCode = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])`

test.describe('Modeling dialogs', { tag: '@desktop' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test.beforeEach(async ({ context, page, homePage, scene }) => {
    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, profileCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()
  })

  test('Toolbar activates, dismisses, and switches modeling dialogs', async ({
    page,
    toolbar,
    editor,
    cmdBar,
  }) => {
    const dialog = page.getByTestId('modeling-dialog')
    await toolbar.extrudeButton.click()
    await expect(dialog.getByText('Extrude', { exact: true })).toBeVisible()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'true')

    await toolbar.extrudeButton.click()
    await expect(dialog).not.toBeAttached()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'false')

    await toolbar.extrudeButton.click()
    await toolbar.revolveButton.click()
    await expect(dialog.getByText('Revolve', { exact: true })).toBeVisible()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'false')
    await expect(toolbar.revolveButton).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeAttached()
    await expect(toolbar.revolveButton).toHaveAttribute('aria-pressed', 'false')

    await page.keyboard.press('ControlOrMeta+K')
    await cmdBar.cmdOptions.getByText('Extrude', { exact: true }).click()
    await expect(dialog.getByText('Extrude', { exact: true })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(profileCode, { shouldNormalise: true })
    await editor.expectEditor.not.toContain('extrude(')
  })

  test('Creates and edits an extrude with selection removal and extent changes', async ({
    page,
    toolbar,
    editor,
    scene,
  }) => {
    const dialog = page.getByTestId('modeling-dialog')
    const distance = dialog.getByRole('textbox', {
      name: 'Distance',
      exact: false,
    })
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })

    await editor.selectText('region(')
    await toolbar.extrudeButton.click()
    await expect(
      dialog.getByRole('button', { name: 'Remove selection 1' })
    ).toBeVisible()
    await dialog.getByRole('button', { name: 'Remove selection 1' }).click()
    await expect(submit).toBeDisabled()
    await editor.scrollToText('sketch001 =')
    await editor.selectText('region(')
    await expect(
      dialog.getByRole('button', { name: 'Remove selection 1' })
    ).toBeVisible()

    await distance.fill('missingDistance')
    await expect(submit).toBeDisabled()
    await distance.fill('12')
    await dialog.getByRole('button', { name: 'Two sides', exact: true }).click()
    await dialog.getByRole('textbox', { name: 'Second distance' }).fill('4')
    await dialog.getByRole('button', { name: 'Symmetric', exact: true }).click()
    await expect(
      dialog.getByRole('textbox', { name: 'Second distance' })
    ).not.toBeAttached()
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(
      'extrude(region001, length = 12, symmetric = true)'
    )
    await editor.expectEditor.not.toContain('bidirectionalLength')
    await scene.settled()

    await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
    await expect(
      dialog.getByRole('button', { name: 'Symmetric', exact: true })
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(distance).toHaveText('12')
    await distance.fill('8')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(
      'extrude(region001, length = 8, symmetric = true)'
    )
    await editor.expectEditor.not.toContain('bidirectionalLength')
    await scene.settled()
  })
})
