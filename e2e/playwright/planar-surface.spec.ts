import { expect, test } from '@e2e/playwright/zoo-test'
import { EXPERIMENTAL_POINT_AND_CLICK_FLAG } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Planar Surface point-and-click', { tag: '@desktop' }, () => {
  test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })

  for (const boundary of [
    {
      name: 'the base circle edge of a moved solid',
      code: `sketch001 = sketch(on = XZ) {
  circle1 = circle(start = [10mm, 0mm], center = [0mm, 0mm])
}
region001 = region(segments = [sketch001.circle1])
hidden001 = hide(sketch001)
extrude001 = extrude(region001, length = 5mm)
  |> translate(x = 25mm)`,
      points: [{ x: 35, y: 0, z: 0 }],
      viewOffset: { x: 0, y: 100, z: 0 },
      curves: ['extrude001.sketch.tags.circle1'],
    },
    {
      name: 'the opposite circle edge of a cloned solid',
      code: `sketch001 = sketch(on = XZ) {
  circle1 = circle(start = [10mm, 0mm], center = [0mm, 0mm])
}
region001 = region(segments = [sketch001.circle1])
hidden001 = hide(sketch001)
extrude001 = extrude(region001, length = 5mm)
extrude002 = clone(extrude001) |> translate(x = 25mm)
hidden002 = hide(extrude001)`,
      points: [{ x: 35, y: -5, z: 0 }],
      viewOffset: { x: 0, y: -100, z: 0 },
      curves: ['getOppositeEdge(extrude002.sketch.tags.circle1)'],
    },
    {
      name: 'an ordered boundary of a cloned solid',
      code: `sketch001 = sketch(on = XY) {
  line1 = line(start = [-10mm, -10mm], end = [10mm, -10mm])
  line2 = line(start = [10mm, -10mm], end = [10mm, 10mm])
  line3 = line(start = [10mm, 10mm], end = [-10mm, 10mm])
  line4 = line(start = [-10mm, 10mm], end = [-10mm, -10mm])
}
region001 = region(segments = [sketch001.line1, sketch001.line2, sketch001.line3, sketch001.line4])
hidden001 = hide(sketch001)
extrude001 = extrude(region001, length = 5mm)
extrude002 = clone(extrude001) |> translate(x = 25mm)
hidden002 = hide(extrude001)`,
      points: [
        { x: 25, y: -10, z: 5 },
        { x: 35, y: 0, z: 5 },
        { x: 25, y: 10, z: 5 },
        { x: 15, y: 0, z: 5 },
      ],
      viewOffset: { x: 0, y: -50, z: 100 },
      curves: [1, 2, 3, 4].map(
        (index) => `getOppositeEdge(extrude002.sketch.tags.line${index})`
      ),
    },
    {
      name: 'a chamfered boundary with mapped and fallback edges',
      code: `sketch001 = sketch(on = XY) {
  line1 = line(start = [-10mm, -10mm], end = [10mm, -10mm])
  line2 = line(start = [10mm, -10mm], end = [10mm, 10mm])
  line3 = line(start = [10mm, 10mm], end = [-10mm, 10mm])
  line4 = line(start = [-10mm, 10mm], end = [-10mm, -10mm])
}
region001 = region(segments = [sketch001.line1, sketch001.line2, sketch001.line3, sketch001.line4])
hidden001 = hide(sketch001)
extrude001 = extrude(region001, length = 5mm, method = NEW)
chamfer001 = chamfer(extrude001, tags = getCommonEdge(faces = [region001.tags.line1, region001.tags.line2]), length = 2mm)`,
      points: [
        { x: -1, y: -10, z: 5 },
        { x: 9, y: -9, z: 5 },
        { x: 10, y: 1, z: 5 },
        { x: 0, y: 10, z: 5 },
        { x: -10, y: 0, z: 5 },
      ],
      viewOffset: { x: 0, y: -50, z: 100 },
      curves: null,
    },
  ]) {
    test(`create by clicking ${boundary.name} in the viewport`, async ({
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
    }) => {
      await page.setBodyDimensions({ width: 1500, height: 900 })
      await homePage.goToModelingScene()
      await editor.replaceCode(
        '',
        `@settings(experimentalFeatures = allow, kclVersion = 2.0)\n${boundary.code}`
      )
      await expect
        .poll(
          () =>
            page.evaluate((code) => {
              const kcl = window.app.singletons.kclManager
              return {
                executing: kcl.isExecuting,
                executed: kcl.lastSuccessfulCode
                  .replace(/\s+/g, '')
                  .includes(code.replace(/\s+/g, '')),
                errors: kcl.errors.map((error) => error.message),
              }
            }, boundary.code),
          { timeout: 15_000 }
        )
        .toEqual({ executing: false, executed: true, errors: [] })
      await scene.settled()
      await toolbar.selectSurface('planar-surface')
      await editor.closePane()

      for (const [index, point] of boundary.points.entries()) {
        // Aim at an edge midpoint so the stream center is a real viewport pick,
        // independent of panel widths and camera framing.
        const camera = {
          x: point.x + boundary.viewOffset.x,
          y: point.y + boundary.viewOffset.y,
          z: point.z + boundary.viewOffset.z,
        }
        await scene.moveCameraTo(camera, point)
        await scene.expectState({
          camera: {
            position: [camera.x, camera.y, camera.z],
            target: [point.x, point.y, point.z],
          },
        })
        await toolbar.closePane(DefaultLayoutPaneID.Logs)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        const [, moveToEdge] = scene.makeMouseHelpers(0.5, 0.5, {
          format: 'ratio',
        })
        await moveToEdge()
        await page.keyboard.down('Shift')
        await page.mouse.down()
        await page.mouse.up()
        await expect(
          page.getByText(
            `${index + 1} ${index === 0 ? 'edge' : 'edges'} selected`,
            { exact: false }
          )
        ).toBeVisible()
        await page.keyboard.up('Shift')
      }

      if (!boundary.curves) {
        const selection = await page.evaluate(
          () =>
            window.app.singletons.kclManager.modelingState?.context
              .selectionRanges
        )
        expect(selection?.graphSelections.length).toBeGreaterThan(0)
        expect(
          selection?.otherSelections.filter(
            (item) =>
              typeof item === 'object' &&
              'type' in item &&
              item.type === 'enginePrimitive'
          ).length
        ).toBeGreaterThan(0)
      }
      await cmdBar.progressCmdBar()
      await cmdBar.submit()
      await scene.settled()
      await editor.openPane()
      if (boundary.curves) {
        await editor.expectEditor.toContain(
          `surface001 = planarSurface([${boundary.curves.join(', ')}])`,
          { shouldNormalise: true }
        )
      } else {
        await editor.expectEditor.toContain('surface001 = planarSurface([')
        await editor.expectEditor.toContain('edge001 = edgeId(')
      }
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await expect(
        await toolbar.getFeatureTreeOperation('surface001', 0)
      ).toBeVisible()
      await expect
        .poll(() =>
          page.evaluate(() =>
            window.app.singletons.kclManager.errors.map(
              (error) => error.message
            )
          )
        )
        .toEqual([])
    })
  }

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

      await test.step('Edit tolerance and preserve the original curve order', async () => {
        await (
          await toolbar.getFeatureTreeOperation('surface001', 0)
        ).dblclick()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {},
          commandName: 'Planar Surface',
        })
        await cmdBar.clickOptionalArgument('tolerance')
        await page.keyboard.insertText('0.01mm')
        await cmdBar.progressCmdBar()
        await cmdBar.submit()
        await scene.settled()
        await editor.expectEditor.toContain(
          profile.declaration.replace(/\)$/, ', tolerance = 0.01mm)')
        )
        await editor.expectEditor.toContain(profile.code, {
          shouldNormalise: true,
        })
      })

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
