import fsp from 'fs/promises'
import path from 'path'

import { expect, test } from '@e2e/playwright/zoo-test'

const twoExtrudes = `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
sketch002 = sketch(on = XY) {
  circle2 = circle(start = [var 23mm, var 0mm], center = [var 20mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])
region002 = region(segments = [sketch002.circle2])
extrude001 = extrude(region001, length = 5mm)
extrude002 = extrude(region002, length = 20mm)`

test.describe('Modeling dialog edit sessions', { tag: '@desktop' }, () => {
  test.use({ userFeatures: ['modeling_dialogs'] })

  test('Keeps drafts separate when switching between Extrude features', async ({
    folderSetupFn,
    page,
    scene,
    editor,
    toolbar,
  }) => {
    await folderSetupFn(async (dir) => {
      const projectDir = path.join(dir, 'dialog-edit-sessions')
      await fsp.mkdir(projectDir, { recursive: true })
      await fsp.writeFile(path.join(projectDir, 'main.kcl'), twoExtrudes)
    })
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await page.getByText('dialog-edit-sessions', { exact: true }).click()
    await scene.settled()
    await editor.expectEditor.toContain(
      'extrude001 = extrude(region001, length = 5mm)'
    )
    await editor.expectEditor.toContain(
      'extrude002 = extrude(region002, length = 20mm)'
    )
    await toolbar.openFeatureTreePane()

    const dialog = page.getByTestId('modeling-dialog')
    const distance = dialog.getByRole('textbox', { name: 'Distance' })
    const submit = dialog.getByRole('button', { name: 'Submit', exact: true })

    await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
    await expect(distance).toHaveText('5mm')
    await distance.fill('11mm')
    await expect(submit).toBeEnabled()

    await (await toolbar.getFeatureTreeOperation('Extrude', 1)).dblclick()
    await expect(distance).toHaveText('20mm')
    await distance.fill('24mm')
    await expect(submit).toBeEnabled()
    await submit.click()

    await expect(dialog).not.toBeAttached()
    await editor.expectEditor.toContain(
      'extrude001 = extrude(region001, length = 5mm)'
    )
    await editor.expectEditor.toContain(
      'extrude002 = extrude(region002, length = 24mm)'
    )
    await editor.expectEditor.not.toContain('length = 11mm')
    await scene.settled()
  })
})
