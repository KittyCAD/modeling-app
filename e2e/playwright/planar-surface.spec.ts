import { expect, test } from '@e2e/playwright/zoo-test'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Planar Surface point-and-click', { tag: '@desktop' }, () => {
  test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })

  test('create from a scene region, edit tolerance, cancel an edit, and delete', async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = sketch(on = XZ) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}`
    const declaration = 'surface001 = planarSurface(region001)'
    const editedDeclaration =
      'surface001 = planarSurface(region001, tolerance = 0.01mm)'

    await page.setBodyDimensions({ width: 1500, height: 900 })
    await homePage.goToModelingScene()
    await editor.replaceCode('', initialCode)
    await scene.settled()

    await test.step('Select the region in the scene and review', async () => {
      await toolbar.selectSurface('planar-surface')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'curves',
        currentArgValue: '',
        headerArguments: { Profiles: '' },
        highlightedHeaderArg: 'Profiles',
        commandName: 'Planar Surface',
      })
      const [clickRegion] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })
      await clickRegion()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: { Profiles: '1 region' },
        commandName: 'Planar Surface',
      })
      await editor.expectEditor.not.toContain('planarSurface(')
      await cmdBar.submit()
      await scene.settled()
      await editor.expectEditor.toContain(declaration)
      await editor.expectEditor.toContain('region001 = region(')
      await editor.expectEditor.toContain('hide(sketch001)')
      await editor.expectState({
        diagnostics: [],
        activeLines: [declaration],
        highlightedCode: '',
      })
    })

    await test.step('Add tolerance through the feature tree', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await (await toolbar.getFeatureTreeOperation('surface001', 0)).dblclick()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {},
        commandName: 'Planar Surface',
      })
      await cmdBar.clickOptionalArgument('tolerance')
      await page.keyboard.insertText('0.01mm')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: { Tolerance: '0.01mm' },
        commandName: 'Planar Surface',
      })
      await cmdBar.submit()
      await scene.settled()
      await editor.expectEditor.toContain(editedDeclaration)
    })

    await test.step('Cancel a tolerance change without modifying the surface', async () => {
      await (await toolbar.getFeatureTreeOperation('surface001', 0)).dblclick()
      await cmdBar.clickHeaderArgument('tolerance')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'tolerance',
        currentArgValue: '0.01mm',
        headerArguments: { Tolerance: '0.01mm' },
        highlightedHeaderArg: 'tolerance',
        commandName: 'Planar Surface',
      })
      await page.keyboard.insertText('0.02mm')
      await cmdBar.progressCmdBar()
      await cmdBar.closeCmdBar()
      await scene.settled()
      await editor.expectEditor.toContain(editedDeclaration)
      await editor.expectEditor.not.toContain('0.02mm')
    })

    await test.step('Delete the surface and preserve its source region', async () => {
      await editor.closePane()
      await (await toolbar.getFeatureTreeOperation('surface001', 0)).click()
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain('planarSurface(')
      await editor.expectEditor.toContain(initialCode, {
        shouldNormalise: true,
      })
    })
  })

  for (const profile of [
    {
      name: 'a closed circle curve',
      code: `sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}`,
      selections: ['circle1 = circle('],
      profiles: '1 edge',
      declaration: 'surface001 = planarSurface([sketch001.circle1])',
    },
    {
      name: 'an ordered loop of partially constrained arcs',
      code: `sketch001 = sketch(on = XY) {
  arc1 = arc(start = [var -5mm, var 0mm], end = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
  arc2 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([arc1.center, arc2.center])
  coincident([arc1.start, arc2.end])
  coincident([arc1.end, arc2.start])
}`,
      selections: ['arc1 = arc(', 'arc2 = arc('],
      profiles: '2 edges',
      declaration:
        'surface001 = planarSurface([sketch001.arc1, sketch001.arc2])',
    },
  ]) {
    test(`create from ${profile.name}`, async ({
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
    }) => {
      await page.setBodyDimensions({ width: 1500, height: 900 })
      await homePage.goToModelingScene()
      await editor.replaceCode('', profile.code)
      await scene.settled()

      await toolbar.selectSurface('planar-surface')
      await editor.selectText(profile.selections[0])
      const multiCursorKey = process.platform === 'darwin' ? 'Meta' : 'Control'
      for (const selection of profile.selections.slice(1)) {
        await page.keyboard.down(multiCursorKey)
        await page.getByText(selection).click()
        await page.keyboard.up(multiCursorKey)
      }
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: { Profiles: profile.profiles },
        commandName: 'Planar Surface',
      })
      await cmdBar.submit()
      await scene.settled()
      await editor.expectEditor.toContain(profile.declaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [profile.declaration],
        highlightedCode: '',
      })
      await expect(
        await toolbar.getFeatureTreeOperation('surface001', 0)
      ).toBeVisible()

      await test.step('Use the created surface in another operation', async () => {
        await toolbar.selectSurface('flip-surface')
        await (await toolbar.getFeatureTreeOperation('surface001', 0)).click()
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Surface: '1 path' },
          commandName: 'Flip Surface',
        })
        await cmdBar.submit()
        await scene.settled()
        await editor.expectEditor.toContain(
          'surface002 = flipSurface(surface001)'
        )
      })
    })
  }
})
