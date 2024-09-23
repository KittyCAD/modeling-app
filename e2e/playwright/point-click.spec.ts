import { test, expect, AuthenticatedApp } from './authenticatedAppFixture'

// test file is for testing point an click code gen functionality that's not sketch mode related

test('verify extruding circle works', async ({ app }) => {
  test.skip(
    process.platform === 'win32',
    'Fails on windows in CI, can not be replicated locally on windows.'
  )
  const file = await app.getInputFile('test-circle-extrude.kcl')
  await app.initialise(file)
  const [clickCircle, moveToCircle] = app.makeMouseHelpers(582, 217)

  await test.step('because there is sweepable geometry, verify extrude is enable when nothing is selected', async () => {
    await app.clickNoWhere()
    await app.expectExtrudeButtonToBeEnabled()
  })

  await test.step('check code model connection works and that button is still enable once circle is selected ', async () => {
    await moveToCircle()
    const circleSnippet =
      'circle({ center: [318.33, 168.1], radius: 182.8 }, %)'
    await app.expectCodeHighlightedToBe(circleSnippet)

    await clickCircle()
    await app.expectActiveLinesToBe([circleSnippet.slice(-5)])
    await app.expectExtrudeButtonToBeEnabled()
  })

  await test.step('do extrude flow and check extrude code is added to editor', async () => {
    await app.clickExtrudeButton()

    await app.expectCmdBarToBe({
      stage: 'arguments',
      currentArgKey: 'distance',
      currentArgValue: '5',
      headerArguments: { Selection: '1 face', Distance: '' },
      highlightedHeaderArg: 'distance',
      commandName: 'Extrude',
    })
    await app.progressCmdBar()

    const expectString = 'const extrude001 = extrude(5, sketch001)'
    await app.expectEditor.not.toContain(expectString)

    await app.expectCmdBarToBe({
      stage: 'review',
      headerArguments: { Selection: '1 face', Distance: '5' },
      commandName: 'Extrude',
    })
    await app.progressCmdBar()

    await app.expectEditor.toContain(expectString)
  })
})

test.describe('verify sketch on chamfer works', () => {
  const _sketchOnAChamfer =
    (app: AuthenticatedApp) =>
    async ({
      clickCoords,
      cameraPos,
      cameraTarget,
      beforeChamferSnippet,
      afterChamferSelectSnippet,
      afterRectangle1stClickSnippet,
      afterRectangle2ndClickSnippet,
    }: {
      clickCoords: { x: number; y: number }
      cameraPos: { x: number; y: number; z: number }
      cameraTarget: { x: number; y: number; z: number }
      beforeChamferSnippet: string
      afterChamferSelectSnippet: string
      afterRectangle1stClickSnippet: string
      afterRectangle2ndClickSnippet: string
    }) => {
      const [clickChamfer] = app.makeMouseHelpers(clickCoords.x, clickCoords.y)
      const [rectangle1stClick] = app.makeMouseHelpers(573, 149)
      const [rectangle2ndClick, rectangle2ndMove] = app.makeMouseHelpers(
        598,
        380,
        { steps: 5 }
      )

      await app.moveCameraTo(cameraPos, cameraTarget)

      await test.step('check chamfer selection changes cursor positon', async () => {
        await expect(async () => {
          // sometimes initial click doesn't register
          await clickChamfer()
          await app.expectActiveLinesToBe([beforeChamferSnippet.slice(-5)])
        }).toPass({ timeout: 40_000, intervals: [500] })
      })

      await test.step('starting a new and selecting a chamfer should animate to the new sketch and possible break up the initial chamfer if it had one than more tag', async () => {
        await app.startSketchPlaneSelection()
        await clickChamfer()
        // timeout wait for engine animation is unavoidable
        await app.page.waitForTimeout(600)
        await app.expectEditor.toContain(afterChamferSelectSnippet)
      })
      await test.step('make sure a basic sketch can be added', async () => {
        await app.rectangleBtn.click()
        await rectangle1stClick()
        await app.expectEditor.toContain(afterRectangle1stClickSnippet)
        await app.u.doAndWaitForImageDiff(() => rectangle2ndMove(), 50)
        await rectangle2ndClick()
        await app.expectEditor.toContain(afterRectangle2ndClickSnippet)
      })

      await test.step('Clean up so that `_sketchOnAChamfer` util can be called again', async () => {
        await app.exitSketchBtn.click()
        await app.waitForExecutionDone()
      })
      await test.step('Check there is no errors after code created in previous steps executes', async () => {
        await app.expectDiagnosticsToBe([])
      })
    }
  test('works on all edge selections and can break up multi edges in a chamfer array', async ({
    app,
  }) => {
    test.skip(
      process.platform === 'win32',
      'Fails on windows in CI, can not be replicated locally on windows.'
    )
    const file = await app.getInputFile('e2e-can-sketch-on-chamfer.kcl')
    await app.initialise(file)

    const sketchOnAChamfer = _sketchOnAChamfer(app)

    await sketchOnAChamfer({
      clickCoords: { x: 570, y: 220 },
      cameraPos: { x: 16020, y: -2000, z: 10500 },
      cameraTarget: { x: -150, y: -4500, z: -80 },
      beforeChamferSnippet: `angledLine([segAng(rectangleSegmentA001)-90,217.26],%,$seg01)
      chamfer({length:30,tags:[
      seg01,
      getNextAdjacentEdge(yo),
      getNextAdjacentEdge(seg02),
      getOppositeEdge(seg01)
    ]}, %)`,
      afterChamferSelectSnippet:
        'const sketch002 = startSketchOn(extrude001, seg03)',
      afterRectangle1stClickSnippet: 'startProfileAt([205.96, 254.59], %)',
      afterRectangle2ndClickSnippet: `angledLine([0, 11.39], %, $rectangleSegmentA002)
    |> angledLine([
         segAng(rectangleSegmentA002) - 90,
         105.26
       ], %, $rectangleSegmentB001)
    |> angledLine([
         segAng(rectangleSegmentA002),
         -segLen(rectangleSegmentA002)
       ], %, $rectangleSegmentC001)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)`,
    })

    await sketchOnAChamfer({
      clickCoords: { x: 690, y: 250 },
      cameraPos: { x: 16020, y: -2000, z: 10500 },
      cameraTarget: { x: -150, y: -4500, z: -80 },
      beforeChamferSnippet: `angledLine([
         segAng(rectangleSegmentA001) - 90,
         217.26
       ], %, $seg01)chamfer({
         length: 30,
         tags: [
           seg01,
           getNextAdjacentEdge(yo),
           getNextAdjacentEdge(seg02)
         ]
       }, %)`,
      afterChamferSelectSnippet:
        'const sketch003 = startSketchOn(extrude001, seg04)',
      afterRectangle1stClickSnippet: 'startProfileAt([-209.64, 255.28], %)',
      afterRectangle2ndClickSnippet: `angledLine([0, 11.56], %, $rectangleSegmentA003)
    |> angledLine([
         segAng(rectangleSegmentA003) - 90,
         106.84
       ], %, $rectangleSegmentB002)
    |> angledLine([
         segAng(rectangleSegmentA003),
         -segLen(rectangleSegmentA003)
       ], %, $rectangleSegmentC002)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)`,
    })
    await sketchOnAChamfer({
      clickCoords: { x: 677, y: 87 },
      cameraPos: { x: -6200, y: 1500, z: 6200 },
      cameraTarget: { x: 8300, y: 1100, z: 4800 },
      beforeChamferSnippet: `angledLine([0, 268.43], %, $rectangleSegmentA001)chamfer({
         length: 30,
         tags: [
           getNextAdjacentEdge(yo),
           getNextAdjacentEdge(seg02)
         ]
       }, %)`,
      afterChamferSelectSnippet:
        'const sketch003 = startSketchOn(extrude001, seg04)',
      afterRectangle1stClickSnippet: 'startProfileAt([-209.64, 255.28], %)',
      afterRectangle2ndClickSnippet: `angledLine([0, 11.56], %, $rectangleSegmentA003)
    |> angledLine([
         segAng(rectangleSegmentA003) - 90,
         106.84
       ], %, $rectangleSegmentB002)
    |> angledLine([
         segAng(rectangleSegmentA003),
         -segLen(rectangleSegmentA003)
       ], %, $rectangleSegmentC002)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)`,
    })
    /// last one
    await sketchOnAChamfer({
      clickCoords: { x: 620, y: 300 },
      cameraPos: { x: -1100, y: -7700, z: 1600 },
      cameraTarget: { x: 1450, y: 670, z: 4000 },
      beforeChamferSnippet: `chamfer({
         length: 30,
         tags: [getNextAdjacentEdge(yo)]
       }, %)`,
      afterChamferSelectSnippet:
        'const sketch005 = startSketchOn(extrude001, seg06)',
      afterRectangle1stClickSnippet: 'startProfileAt([-23.43, 19.69], %)',
      afterRectangle2ndClickSnippet: `angledLine([0, 9.1], %, $rectangleSegmentA005)
    |> angledLine([
         segAng(rectangleSegmentA005) - 90,
         84.07
       ], %, $rectangleSegmentB004)
    |> angledLine([
         segAng(rectangleSegmentA005),
         -segLen(rectangleSegmentA005)
       ], %, $rectangleSegmentC004)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)`,
    })

    await test.step('verif at the end of the test that final code is what is expected', async () => {
      await app.expectEditor.toContain(
        `const sketch001 = startSketchOn('XZ')
      |> startProfileAt([75.8, 317.2], %) // [$startCapTag, $EndCapTag]
      |> angledLine([0, 268.43], %, $rectangleSegmentA001)
      |> angledLine([
           segAng(rectangleSegmentA001) - 90,
           217.26
         ], %, $seg01)
      |> angledLine([
           segAng(rectangleSegmentA001),
           -segLen(rectangleSegmentA001)
         ], %, $yo)
      |> lineTo([profileStartX(%), profileStartY(%)], %, $seg02)
      |> close(%)
    const extrude001 = extrude(100, sketch001)
      |> chamfer({
           length: 30,
           tags: [getOppositeEdge(seg01)]
         }, %, $seg03)
      |> chamfer({ length: 30, tags: [seg01] }, %, $seg04)
      |> chamfer({
           length: 30,
           tags: [getNextAdjacentEdge(seg02)]
         }, %, $seg05)
      |> chamfer({
           length: 30,
           tags: [getNextAdjacentEdge(yo)]
         }, %, $seg06)
    const sketch005 = startSketchOn(extrude001, seg06)
      |> startProfileAt([-23.43, 19.69], %)
      |> angledLine([0, 9.1], %, $rectangleSegmentA005)
      |> angledLine([
           segAng(rectangleSegmentA005) - 90,
           84.07
         ], %, $rectangleSegmentB004)
      |> angledLine([
           segAng(rectangleSegmentA005),
           -segLen(rectangleSegmentA005)
         ], %, $rectangleSegmentC004)
      |> lineTo([profileStartX(%), profileStartY(%)], %)
      |> close(%)
    const sketch004 = startSketchOn(extrude001, seg05)
      |> startProfileAt([82.57, 322.96], %)
      |> angledLine([0, 11.16], %, $rectangleSegmentA004)
      |> angledLine([
           segAng(rectangleSegmentA004) - 90,
           103.07
         ], %, $rectangleSegmentB003)
      |> angledLine([
           segAng(rectangleSegmentA004),
           -segLen(rectangleSegmentA004)
         ], %, $rectangleSegmentC003)
      |> lineTo([profileStartX(%), profileStartY(%)], %)
      |> close(%)
    const sketch003 = startSketchOn(extrude001, seg04)
      |> startProfileAt([-209.64, 255.28], %)
      |> angledLine([0, 11.56], %, $rectangleSegmentA003)
      |> angledLine([
           segAng(rectangleSegmentA003) - 90,
           106.84
         ], %, $rectangleSegmentB002)
      |> angledLine([
           segAng(rectangleSegmentA003),
           -segLen(rectangleSegmentA003)
         ], %, $rectangleSegmentC002)
      |> lineTo([profileStartX(%), profileStartY(%)], %)
      |> close(%)
    const sketch002 = startSketchOn(extrude001, seg03)
      |> startProfileAt([205.96, 254.59], %)
      |> angledLine([0, 11.39], %, $rectangleSegmentA002)
      |> angledLine([
           segAng(rectangleSegmentA002) - 90,
           105.26
         ], %, $rectangleSegmentB001)
      |> angledLine([
           segAng(rectangleSegmentA002),
           -segLen(rectangleSegmentA002)
         ], %, $rectangleSegmentC001)
      |> lineTo([profileStartX(%), profileStartY(%)], %)
      |> close(%)
    `,
        { shouldNormalise: true }
      )
    })
  })
})
