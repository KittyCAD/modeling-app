import { expect, test } from '@e2e/playwright/zoo-test'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })

test('GD&T defaults follow selected faces and edges @web', async ({
  page,
  homePage,
  scene,
  editor,
  toolbar,
  modelingDialog,
}) => {
  const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0)
profile = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [10mm, 0mm])
  right = line(start = [10mm, 0mm], end = [10mm, 20mm])
  top = line(start = [10mm, 20mm], end = [0mm, 20mm])
  left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
box = region(point = [5mm, 5mm], sketch = profile)
body = extrude(box, length = 5mm, tagEnd = $capEnd)
hide(profile)`
  await page.setBodyDimensions({ width: 1000, height: 700 })
  await homePage.goToModelingScene()
  await scene.settled()
  await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
  await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
  await toolbar.closePane(DefaultLayoutPaneID.Code)
  await scene.moveCameraTo({ x: 5, y: -35, z: 40 }, { x: 5, y: 10, z: 2.5 })

  const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
  await clickCenter()
  await toolbar.expectSelection('1 face')
  await page.getByRole('button', { name: 'caret down gdt: open menu' }).click()
  await page.getByTestId('dropdown-gdt-datum').click()
  await expect(modelingDialog.input('frame position')).toHaveText(
    'Use defaults'
  )
  await expect(modelingDialog.input('font size')).toHaveText('Use defaults')
  await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
  await editor.expectEditor.toContain('face = capEnd')
  await editor.expectEditor.toContain('fontSize = 0.8167mm')
  await editor.expectEditor.toContain('framePlane = XZ')
  await editor.expectEditor.toContain('framePosition = [15, 15]')

  await toolbar.openFeatureTreePane()
  await (await toolbar.getFeatureTreeOperation('annotation001', 0)).dblclick()
  await modelingDialog.input('name').fill('B')
  await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
  await editor.expectEditor.toContain('name = "B"')
  await editor.expectEditor.toContain('fontSize = 0.8167mm')
  await editor.expectEditor.toContain('framePlane = XZ')
  await editor.expectEditor.toContain('framePosition = [15, 15]')

  await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
  await toolbar.closePane(DefaultLayoutPaneID.Code)
  await scene.moveCameraTo({ x: -35, y: -40, z: 30 }, { x: 0, y: 0, z: 2.5 })
  await clickCenter()
  await toolbar.expectSelection('1 edge')
  await page.getByRole('button', { name: 'caret down gdt: open menu' }).click()
  await page.getByTestId('dropdown-gdt-distance').click()
  await scene.waitForExecutionDoneAfter(() => modelingDialog.submit())
  await editor.expectEditor.toContain('gdt::distance(')
  await editor.expectEditor.toContain('framePosition = [5, 5]')
})
