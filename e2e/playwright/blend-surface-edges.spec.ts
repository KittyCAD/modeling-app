import { expect, test } from '@e2e/playwright/zoo-test'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'

test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })

test(
  'Blend bottom edges of sketch block surfaces',
  { tag: '@web' },
  async ({ page, homePage, scene, editor, toolbar, cmdBar }) => {
    const code = `@settings(defaultLengthUnit = mm, kclVersion = 3.0, experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -9.76mm, var 1.02mm], end = [var -4.06mm, var 5.49mm])
}
surface001 = extrude(sketch001.line1, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = XY) {
  line1 = line(start = [var -13.52mm, var 5.92mm], end = [var -6.48mm, var 9.82mm])
}
surface002 = extrude(sketch002.line1, length = 5, bodyType = SURFACE)
hide(sketch001)
hide(sketch002)`

    await page.setBodyDimensions({ width: 1000, height: 600 })
    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await editor.expectEditor.toContain('surface001 = extrude(sketch001.line1')
    await editor.expectEditor.toContain('surface002 = extrude(sketch002.line1')
    await scene.settled()
    await page.evaluate(() => window.zoomToFit?.())
    await page.waitForTimeout(1000)
    const [selectFirstEdge] = scene.makeMouseHelpers(0.5392, 0.7239, {
      format: 'ratio',
    })
    const [selectSecondEdge] = scene.makeMouseHelpers(0.7203, 0.5616, {
      format: 'ratio',
    })
    await selectFirstEdge()
    await expect(toolbar.selectionStatus).toContainText('1 edge')
    await page.keyboard.down('Shift')
    await selectSecondEdge()
    await expect(toolbar.selectionStatus).toContainText(/2 (?:segments?|edges)/)
    await page.keyboard.up('Shift')
    await toolbar.selectSurface('blend-surface')
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'review',
      commandName: 'Blend',
      headerArguments: { Edges: '2 edges' },
      reviewValidationError: undefined,
    })
    await scene.waitForExecutionDoneAfter(() => cmdBar.submit())
    await scene.settled()
    await editor.expectEditor.toContain('blend001 = blend(')
  }
)
