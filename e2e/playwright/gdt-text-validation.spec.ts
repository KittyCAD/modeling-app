import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'GD&T note dialog rejects unsupported text without changing the document',
  { tag: ['@web', '@browsers', '@localRenderer'] },
  async ({ page, homePage, scene, editor, modelingDialog }) => {
    const code = `@settings(kclVersion = 3.0, defaultLengthUnit = mm)
profile = sketch(on = XY) {
  circle1 = circle(start = [10mm, 0mm], center = [0mm, 0mm])
}
body = extrude(region(segments = [profile.circle1]), length = 10mm)
`
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await scene.settled()
    await editor.closePane()
    await page
      .getByRole('button', { name: 'caret down gdt: open menu' })
      .click()
    await page.getByTestId('dropdown-gdt-note').click()
    for (const text of [
      'Use "datum A"',
      'C:\\parts',
      'line\nbreak',
      'tab\there',
    ]) {
      await modelingDialog.input('note').fill(text)
      await modelingDialog.submitButton.click()
      await expect(modelingDialog.locator.getByRole('alert')).toContainText(
        /Double quotes|Backslashes|single line/
      )
      await expect(modelingDialog.input('note')).toHaveValue(text)
      await editor.expectEditor.not.toContain('gdt::note(')
    }
    await modelingDialog.input('note').fill("Use the part's datum")
    await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
    await scene.settled()
    await editor.expectEditor.toContain('gdt::note(')
    await editor.expectEditor.toContain("Use the part's datum")
    expect(
      await page.evaluate(() => window.app.singletons.kclManager.errors)
    ).toEqual([])
  }
)

test(
  'editing a datum plane revalidates its existing unsupported name',
  { tag: ['@web', '@browsers', '@localRenderer'] },
  async ({ homePage, scene, editor, toolbar, modelingDialog }) => {
    const code = `@settings(kclVersion = 3.0, defaultLengthUnit = mm)
profile = sketch(on = XY) {
  circle1 = circle(start = [10mm, 0mm], center = [0mm, 0mm])
}
body = extrude(region(segments = [profile.circle1]), length = 10mm, tagEnd = $topFace)
datum001 = gdt::datum(face = topFace, name = 'bad"name', framePlane = XY)
`
    await homePage.goToModelingScene()
    await scene.settled()
    await editor.openPane()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await scene.settled()
    await toolbar.openFeatureTreePane()
    await (await toolbar.getFeatureTreeOperation('Datum', 0)).dblclick()
    await expect(modelingDialog.input('name')).toHaveValue('bad"name')
    await modelingDialog
      .options('frame plane')
      .selectOption({ label: 'XZ Plane' })
    await modelingDialog.submitButton.click()
    await expect(modelingDialog.locator.getByRole('alert')).toContainText(
      'Double quotes'
    )
    await editor.expectEditor.toContain('framePlane = XY')
    await modelingDialog.input('name').fill('B')
    await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
    await scene.settled()
    await editor.expectEditor.toContain('name = "B"')
    await editor.expectEditor.toContain('framePlane = XZ')
  }
)
