import { expect, test } from '@e2e/playwright/zoo-test'

const code = `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(center = [var 0mm, var 0mm], start = [var 10mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])`

test('previews extrusion distance without writing until Submit @web @localRenderer', async ({
  page,
  homePage,
  scene,
  editor,
  toolbar,
  modelingDialog,
}) => {
  await homePage.goToModelingScene()
  await scene.settled()
  await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
  const original = await editor.getCurrentCode()
  await editor.closePane()
  await toolbar.extrudeButton.click()
  await editor.selectText('region001 = region')
  await expect(modelingDialog.selection('Profiles')).toHaveText('1 region')
  await expect(
    modelingDialog.locator.getByRole('checkbox', {
      name: 'Live preview (experimental)',
    })
  ).not.toBeAttached()
  const status = modelingDialog.locator.getByRole('status')
  await expect(status).toHaveText(/^Preview \(/, { timeout: 60_000 })
  const length = modelingDialog.input('length')
  await length.fill('12mm')
  await expect(status).toHaveText('Preview (12mm)', { timeout: 60_000 })
  await editor.expectEditor.toBe(original)
  const handle = page.getByRole('button', { name: 'Drag extrusion distance' })
  await expect(handle).toContainText('12mm')
  await expect(handle).toHaveCSS('pointer-events', 'auto')
  await expect
    .poll(() =>
      handle.evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return element.contains(
          document.elementFromPoint(
            rect.x + rect.width / 2,
            rect.y + rect.height / 2
          )
        )
      })
    )
    .toBe(true)
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Missing extrusion distance handle')
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2
  )
  await page.mouse.down()
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2 - 40,
    { steps: 8 }
  )
  await page.mouse.up()
  await expect(length).not.toHaveText('12mm')
  await editor.expectEditor.toBe(original)
  await modelingDialog.cancelButton.click()
  await expect(handle).not.toBeAttached()
  await editor.expectEditor.toBe(original)

  await toolbar.extrudeButton.click()
  await editor.selectText('region001 = region')
  await modelingDialog.input('length').fill('8mm')
  await expect(modelingDialog.locator.getByRole('status')).toHaveText(
    'Preview (8mm)',
    { timeout: 60_000 }
  )
  await modelingDialog.submit()
  await scene.settled()
  await editor.expectEditor.toContain('length = 8mm')
  const committed = await editor.getCurrentCode()
  await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
  await modelingDialog.input('length').fill('-12mm')
  await expect(modelingDialog.locator.getByRole('status')).toHaveText(
    'Preview (-12mm)',
    { timeout: 60_000 }
  )
  await expect(handle).toContainText('-12mm')
  await editor.expectEditor.toBe(committed)
  await modelingDialog.cancelButton.click()
  await expect(handle).not.toBeAttached()
  await editor.expectEditor.toBe(committed)
  await page.keyboard.press('ControlOrMeta+z')
  await scene.settled()
  await editor.expectEditor.toBe(original)
})
