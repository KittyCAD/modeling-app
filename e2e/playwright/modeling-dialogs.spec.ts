import { expect, test } from '@e2e/playwright/zoo-test'
import { NAMED_VIEWS_UI_FEATURE_FLAG } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout'

const profileCode = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2mm, var 10mm], center = [var 0mm, var 10mm])
  line1 = line(start = [var -10mm, var 0mm], end = [var -10mm, var 20mm])
}
region001 = region(segments = [sketch001.circle1])`

test.describe('Modeling dialogs', { tag: '@web' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test('Uses dialogs for supported commands and the palette for mixed selections', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', profileCode)
    )
    await editor.selectText('region(')
    await toolbar.revolveButton.click()

    const { locator: dialog, submitButton: submit } = modelingDialog
    const axisMode = modelingDialog.options(/axis or edge/i)
    await expect(dialog).toBeVisible()
    await axisMode.selectOption({ label: 'Edge' })
    await expect(modelingDialog.selection('Edge')).toBeVisible()
    await expect(submit).toBeDisabled()
    await axisMode.selectOption({ label: 'Sketch Axis' })
    await expect(submit).toBeEnabled()
    await axisMode.selectOption({ label: 'Edge' })
    await modelingDialog.selection('Edge').click()
    await editor.selectText('line(')
    await modelingDialog.input(/^angle$/i).fill('180deg')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('angle = 180deg')
    await editor.expectEditor.toContain('axis = sketch001.line1')
    await scene.settled()

    await toolbar.openFeatureTreePane()
    await (await toolbar.getFeatureTreeOperation('Revolve', 0)).dblclick()
    await expect(axisMode).not.toBeAttached()
    await modelingDialog.input(/^angle$/i).fill('90deg')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('angle = 90deg')
    await editor.expectEditor.toContain('axis = sketch001.line1')
    await scene.settled()

    await toolbar.helixButton.click()
    const helixLength = modelingDialog.input(/^length$/i)
    await expect(helixLength).not.toHaveAttribute(
      'aria-placeholder',
      'Use defaults'
    )
    await modelingDialog.options(/^mode\b/i).selectOption({
      label: 'Edge',
    })
    await expect(helixLength).toHaveAttribute(
      'aria-placeholder',
      'Use defaults'
    )
    await modelingDialog.selection('Edge').click()
    await editor.selectText('line(')
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('helix(axis = sketch001.line1', {
      shouldNormalise: true,
    })
    await scene.settled()

    await toolbar.translateButton.click()
    await expect(page.getByTestId('command-bar')).toBeVisible()
    await expect(dialog).not.toBeAttached()
    await page.keyboard.press('Escape')
  })

  test('Creates and edits Extrude without losing collapsed fields or selection drafts', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 600 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', profileCode)
    )
    await editor.selectText('region(')
    await toolbar.extrudeButton.click()

    const { locator: dialog, submitButton: submit } = modelingDialog
    const length = modelingDialog.input(/^length$/i)
    const profiles = modelingDialog.selection('Profiles')
    const tagStart = modelingDialog.input(/^tag start$/i)
    await expect(length).toHaveText('5')
    await expect(tagStart).toBeHidden()
    await expect(modelingDialog.options(/^symmetric$/i)).toBeVisible()
    await expect(profiles).toContainText(/1 region/i)
    await expect(profiles).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(length).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(profiles).not.toHaveCSS('box-shadow', 'none')

    await modelingDialog.selection('To').click()
    await expect(profiles).toContainText(/1 region/i)
    await profiles.click()
    await expect(profiles).toContainText(/1 region/i)

    await length.fill('missingLength')
    await expect(submit).toBeDisabled()
    await length.fill('12mm')
    await expect(submit).toBeEnabled()
    const initialPosition = await dialog.boundingBox()
    if (!initialPosition) throw new Error('Modeling dialog is not visible')
    await page.mouse.move(initialPosition.x + 20, initialPosition.y + 15)
    await page.mouse.down()
    await page.mouse.move(initialPosition.x - 140, initialPosition.y + 15)
    await page.mouse.up()
    await expect(dialog).toHaveCSS('position', 'fixed')
    expect((await dialog.boundingBox())?.x).toBeCloseTo(initialPosition.x - 160)
    const more = modelingDialog.advanced
    await more.click()
    await expect(submit).toBeInViewport()
    await expect(modelingDialog.cancelButton).toBeInViewport()
    await expect(tagStart).toHaveAttribute('placeholder', 'None')
    await tagStart.fill('startFace')
    await more.click()
    await page.setBodyDimensions({ width: 1100, height: 540 })
    await expect
      .poll(() =>
        dialog.evaluate((element) => {
          const panel = element.getBoundingClientRect()
          const bounds = element.parentElement?.getBoundingClientRect()
          return (
            bounds &&
            panel.top >= bounds.top &&
            panel.left >= bounds.left &&
            panel.bottom <= bounds.bottom &&
            panel.right <= bounds.right
          )
        })
      )
      .toBe(true)
    await expect(submit).toBeInViewport()
    await expect(dialog.locator('header')).toBeInViewport()
    await page.setBodyDimensions({ width: 1200, height: 600 })
    await expect
      .poll(() => dialog.boundingBox())
      .toMatchObject({
        width: initialPosition.width,
        height: initialPosition.height,
      })
    await submit.click()
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('length = 12mm')
    await editor.expectEditor.toContain('tagStart = $startFace')
    await scene.settled()

    await toolbar.openFeatureTreePane()
    const operation = await toolbar.getFeatureTreeOperation('Extrude', 0)
    await operation.dblclick()
    await expect(length).toHaveText('12mm')
    await expect(length).toBeFocused()
    await expect(tagStart).toBeHidden()
    await more.click()
    await expect(tagStart).toHaveValue('startFace')
    await length.fill('99mm')
    await modelingDialog.cancelButton.click()
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

test.describe('Named View dialog', { tag: '@web' }, () => {
  test.use({
    userFeatures: ['modeling_dialogs', NAMED_VIEWS_UI_FEATURE_FLAG],
  })

  test('Creates, edits visibility, and removes from the pane', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }) => {
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', profileCode)
    )
    await toolbar.openPane(DefaultLayoutPaneID.NamedViews)
    const pane = page.locator(`#${DefaultLayoutPaneID.NamedViews}-pane`)
    await pane.getByTestId('named-view-create').click()

    const dialog = page.getByTestId('modeling-dialog')
    const name = dialog.getByRole('textbox', { name: /^name/i })
    const exceptions = dialog.getByRole('button', {
      name: 'Select Exceptions',
      exact: true,
    })
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })
    await name.fill('Inspection')
    await dialog
      .getByRole('combobox', { name: /^orientation/i })
      .selectOption({ label: 'Front' })
    await editor.selectText('region(')
    await expect(exceptions).toContainText(/1 region/i)
    await dialog.getByText('Advanced', { exact: true }).click()
    await dialog
      .getByRole('textbox', { name: /^target$/i })
      .fill('[0mm, 0mm, 0mm]')
    await dialog.getByRole('textbox', { name: /^distance$/i }).fill('100mm')
    await scene.waitForExecutionDoneAfter(() => submit.click())
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('except = [region001]')
    await editor.expectEditor.toContain('distance = 100mm')

    const row = pane
      .getByTestId('named-view-row')
      .filter({ hasText: 'Inspection' })
    await row.getByTestId('named-view-label').dblclick()
    await expect(exceptions).toBeEnabled()
    await exceptions.click()
    await editor.selectText('sketch(on = XY)')
    await expect(exceptions).toContainText(/1 sketch/i)
    await scene.waitForExecutionDoneAfter(() => submit.click())
    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain('except = [sketch001]')
    await editor.expectEditor.toContain('distance = 100mm')

    await toolbar.openFeatureTreePane()
    await expect(
      page
        .getByTestId('feature-tree-operation-item')
        .filter({ hasText: 'Named View' })
    ).toHaveCount(0)
    await row.getByTestId('named-view-actions').click()
    await scene.waitForExecutionDoneAfter(() =>
      page.getByRole('button', { name: 'Remove', exact: true }).click()
    )
    await expect(row).not.toBeAttached()
    await editor.expectEditor.not.toContain('view::named(')
  })
})
