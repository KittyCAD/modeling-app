import { expect, test } from '@e2e/playwright/zoo-test'

const profileCode = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2mm, var 10mm], center = [var 0mm, var 10mm])
  line1 = line(start = [var -10mm, var 0mm], end = [var -10mm, var 20mm])
}
region001 = region(segments = [sketch001.circle1])`

test.describe('Modeling dialogs', { tag: '@web' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test('Submits with Enter after scene selection', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XZ) {
  circle1 = circle(start = [var 20mm, var 0mm], center = [var 0mm, var 0mm])
}`
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await scene.moveCameraTo({ x: 0, y: -100, z: 0 })
    await toolbar.extrudeButton.click()
    await expect(modelingDialog.selection('Profiles')).toBeFocused()
    const [selectProfile] = scene.makeMouseHelpers(0.38, 0.5, {
      format: 'ratio',
    })
    await selectProfile()
    await expect(modelingDialog.submitButton).toBeEnabled()
    await expect(modelingDialog.selection('Profiles')).not.toBeFocused()
    await scene.waitForExecutionDoneAfter(async () => {
      await page.keyboard.press('Enter')
      await expect(modelingDialog.locator).not.toBeAttached()
    })
    await editor.expectEditor.toContain('extrude(region001, length = 5)')
  })

  test('Preserves an Extrude draft while hiding an obstruction', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
sketch002 = sketch(on = XY) {
  circle1 = circle(start = [var 12mm, var 0mm], center = [var 0mm, var 0mm])
}
region002 = region(segments = [sketch002.circle1])
obstruction = extrude(region002, length = 20mm)`
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await toolbar.openFeatureTreePane()
    await toolbar.extrudeButton.click()
    const length = modelingDialog.input(/^length$/i)
    const profiles = modelingDialog.selection('Profiles')
    await expect(length).toHaveText('5')
    await length.fill('12mm')
    await expect(profiles).toHaveText('Select in the scene')

    const row = page
      .locator('#bodies-list-pane')
      .getByRole('button', { name: 'Body 1', exact: true })
      .locator('..')
    await row.hover()
    await scene.waitForExecutionDoneAfter(() =>
      row.getByTestId('feature-tree-visibility-toggle').click()
    )
    await editor.expectEditor.toContain(/hide\(\s*(?:\[\s*)?obstruction/)
    await expect(modelingDialog.locator).toBeVisible()
    await expect(length).toHaveText('12mm')
    await expect(profiles).toHaveText('Select in the scene')

    await editor.selectText('region001 = region')
    await expect(profiles).toContainText(/1 region/i)
    // Show and hide the obstruction again without replacing the chosen profile.
    for (let toggle = 0; toggle < 2; toggle++) {
      await row.hover()
      await scene.waitForExecutionDoneAfter(() =>
        row.getByTestId('feature-tree-visibility-toggle').click()
      )
      await expect(profiles).toContainText(/1 region/i)
      await expect(length).toHaveText('12mm')
    }
    await expect(modelingDialog.submitButton).toBeEnabled()
    await scene.waitForExecutionDoneAfter(() =>
      modelingDialog.submitButton.click()
    )
    await expect(modelingDialog.locator).not.toBeAttached()
    await editor.expectEditor.toContain('extrude(region001, length = 12mm)')
  })

  test('Uses dialogs for supported commands and the palette for unsupported inputs', async ({
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
    await expect(dialog).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeAttached()

    await page
      .getByRole('button', { name: 'caret down gdt: open menu' })
      .click()
    await page.getByTestId('dropdown-gdt-note').click()
    await expect(page.getByTestId('command-bar')).toBeVisible()
    await expect(dialog).not.toBeAttached()
    await page.keyboard.press('Escape')
  })

  test('Keeps Boolean target and tool selections when switching collectors', async ({
    homePage,
    scene,
    editor,
    toolbar,
    modelingDialog,
  }) => {
    const bodiesCode = `${profileCode}
body001 = extrude(region001, length = 10mm)
body002 = clone(body001)
  |> translate(x = 2mm)`
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() =>
      editor.replaceCode('', bodiesCode)
    )
    await editor.selectText('extrude(')
    await toolbar.selectBoolean('subtract')
    const solids = modelingDialog.selection('Solids')
    const tools = modelingDialog.selection('Tools')
    await expect(solids).toContainText(/1 sweep/i)
    await tools.click()
    await expect(tools).toHaveText('Select in the scene')
    await editor.selectText('clone(')
    await expect(tools).toContainText(/1 sweep/i)
    await solids.click()
    await expect(solids).toContainText(/1 sweep/i)
    await tools.click()
    await expect(tools).toContainText(/1 sweep/i)
    await tools.press('Enter')
    await expect(modelingDialog.locator).not.toBeAttached()
    await editor.expectEditor.toContain('subtract(body001, tools = body002)')
    await scene.settled()
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
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'true')
    await expect(toolbar.revolveButton).toHaveAttribute('aria-pressed', 'false')

    const { locator: dialog, submitButton: submit } = modelingDialog
    const length = modelingDialog.input(/^length$/i)
    const profiles = modelingDialog.selection('Profiles')
    const profileReferences = dialog.getByRole('group', {
      name: 'Profiles selections',
    })
    const profileReference = profileReferences.getByText('region001', {
      exact: true,
    })
    const removeProfile = profileReferences.getByRole('button', {
      name: 'Remove Region from selection',
    })
    const tagStart = modelingDialog.input(/^tag start$/i)
    await expect(
      dialog.getByText('Only parallel faces are supported for now.', {
        exact: true,
      })
    ).toBeVisible()
    await expect(length).toHaveText('5')
    await expect(tagStart).toBeHidden()
    await expect(modelingDialog.options(/^symmetric$/i)).toBeVisible()
    await expect(profiles).toContainText(/1 region/i)
    await expect(profiles).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(removeProfile).toBeFocused()
    await page.keyboard.press('Tab')
    const lengthHelp = dialog.getByRole('button', {
      name: 'Help for Length',
      exact: true,
    })
    await expect(lengthHelp).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(length).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(lengthHelp).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Shift+Tab')
    await expect(profiles).not.toHaveCSS('box-shadow', 'none')

    const beforeHelp = await dialog.boundingBox()
    await dialog.getByRole('button', { name: 'Command help' }).click()
    const docs = page.getByRole('link', { name: 'KCL docs', exact: true })
    await expect(docs).toBeInViewport()
    expect(await dialog.boundingBox()).toEqual(beforeHelp)
    await expect(dialog).not.toHaveCSS('position', 'fixed')
    await page.keyboard.press('Escape')
    await expect(docs).not.toBeVisible()
    await expect(dialog).toBeVisible()

    await modelingDialog.selection('To').click()
    await expect(profiles).toContainText(/1 region/i)
    await expect(profileReference).toBeHidden()
    await profileReferences.getByText('Region', { exact: true }).hover()
    await expect(profileReference).toBeVisible()
    await profiles.hover()
    await expect(profileReference).toBeHidden()
    await profiles.click()
    await removeProfile.press('Enter')
    await expect(profiles).toHaveText('Select in the scene')
    await expect(submit).toBeDisabled()
    await expect(profiles).toBeFocused()
    await expect(page.getByTestId('selection-status')).toContainText(
      'No selection'
    )
    await editor.selectText('line(')
    await editor.selectText('region(')
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
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'false')

    await toolbar.openFeatureTreePane()
    const operation = await toolbar.getFeatureTreeOperation('Extrude', 0)
    await operation.dblclick()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'true')
    await expect(length).toHaveText('12mm')
    await expect(length).toBeFocused()
    await expect(tagStart).toBeHidden()
    await more.click()
    await expect(tagStart).toHaveValue('startFace')
    await length.fill('99mm')
    await modelingDialog.cancelButton.click()
    await expect(dialog).not.toBeAttached()
    await expect(toolbar.extrudeButton).toHaveAttribute('aria-pressed', 'false')
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
