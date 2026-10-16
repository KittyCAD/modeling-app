import { expect, test } from '@e2e/playwright/zoo-test'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'

test.describe('Planar Surface point-and-click', { tag: '@desktop' }, () => {
  test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })

  test('create from a sketch region', async ({
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const code = `@settings(experimentalFeatures = allow, kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle1])`
    const declaration = 'surface001 = planarSurface(region001)'

    await homePage.goToModelingScene()
    await scene.settled()
    await scene.waitForExecutionDoneAfter(() => editor.replaceCode('', code))
    await toolbar.selectSurface('planar-surface')
    await editor.selectText('region001 = region(')
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'review',
      headerArguments: { Profiles: '1 region' },
      commandName: 'Planar Surface',
    })
    await scene.waitForExecutionDoneAfter(() => cmdBar.submit())
    await editor.expectEditor.toContain(declaration)
    await editor.expectState({
      diagnostics: [],
      activeLines: [declaration],
      highlightedCode: '',
    })
    await expect(
      await toolbar.getFeatureTreeOperation('surface001', 0)
    ).toBeVisible()
  })
})
