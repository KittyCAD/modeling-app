import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test(
  'can start sketches after creating and switching KCL files',
  { tag: '@web' },
  async ({ page, homePage, toolbar, scene, editor }) => {
    await homePage.createAndGoToProject('sketch-file-switching')
    await toolbar.openPane(DefaultLayoutPaneID.Code)
    await toolbar.openPane(DefaultLayoutPaneID.Files)

    for (const [index, fileName] of [
      'main.kcl',
      'foo.kcl',
      'main.kcl',
    ].entries()) {
      await test.step(`Sketch in ${fileName}`, async () => {
        if (fileName === 'foo.kcl') {
          await toolbar.createFile({
            fileName,
            waitForToastToDisappear: false,
          })
        } else if (index > 0) {
          await toolbar.openFile(fileName)
        }
        await expect(page).toHaveURL(new RegExp(`${fileName}$`))
        await scene.settled()
        await toolbar.startSketchPlaneSelection()
        const [clickPlane] = scene.makeMouseHelpers(0.5, 0.6, {
          format: 'ratio',
        })
        await clickPlane()
        await expect
          .poll(async () => {
            const code = await editor.getCurrentCode()
            return code.match(/sketch\(on = XY\)/g)?.length ?? 0
          })
          .toBe(index === 2 ? 2 : 1)
        await toolbar.exitSketch()
      })
    }
  }
)
