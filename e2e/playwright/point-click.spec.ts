import { test, expect, AuthenticatedApp } from './fixtures/fixtureSetup'
import { EditorFixture } from './fixtures/editorFixture'
import { SceneFixture } from './fixtures/sceneFixture'
import { ToolbarFixture } from './fixtures/toolbarFixture'

// test file is for testing point an click code gen functionality that's not sketch mode related

test(
  'verify extruding circle works',
  { tag: ['@skipWin'] },
  async ({ app, cmdBar, editor, toolbar, scene }) => {
    test.skip(
      process.platform === 'win32',
      'Fails on windows in CI, can not be replicated locally on windows.'
    )
    const file = await app.getInputFile('test-circle-extrude.kcl')
    await app.initialise(file)
    const [clickCircle, moveToCircle] = scene.makeMouseHelpers(582, 217)

    await test.step('because there is sweepable geometry, verify extrude is enable when nothing is selected', async () => {
      await scene.clickNoWhere()
      await expect(toolbar.extrudeButton).toBeEnabled()
    })

    await test.step('check code model connection works and that button is still enable once circle is selected ', async () => {
      await moveToCircle()
      const circleSnippet =
        'circle({ center: [318.33, 168.1], radius: 182.8 }, %)'
      await editor.expectState({
        activeLines: [],
        highlightedCode: circleSnippet,
        diagnostics: [],
      })

      await clickCircle()
      await editor.expectState({
        activeLines: [circleSnippet.slice(-5)],
        highlightedCode: circleSnippet,
        diagnostics: [],
      })
      await expect(toolbar.extrudeButton).toBeEnabled()
    })

    await test.step('do extrude flow and check extrude code is added to editor', async () => {
      await toolbar.extrudeButton.click()

      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'distance',
        currentArgValue: '5',
        headerArguments: { Selection: '1 face', Distance: '' },
        highlightedHeaderArg: 'distance',
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()

      const expectString = 'extrude001 = extrude(5, sketch001)'
      await editor.expectEditor.not.toContain(expectString)

      await cmdBar.expectState({
        stage: 'review',
        headerArguments: { Selection: '1 face', Distance: '5' },
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()

      await editor.expectEditor.toContain(expectString)
    })
  }
)

test.describe('verify sketch on chamfer works', () => {
  const _sketchOnAChamfer =
    (
      app: AuthenticatedApp,
      editor: EditorFixture,
      toolbar: ToolbarFixture,
      scene: SceneFixture
    ) =>
    async ({
      clickCoords,
      cameraPos,
      cameraTarget,
      beforeChamferSnippet,
      afterChamferSelectSnippet,
      afterRectangle1stClickSnippet,
      afterRectangle2ndClickSnippet,
      beforeChamferSnippetEnd,
    }: {
      clickCoords: { x: number; y: number }
      cameraPos: { x: number; y: number; z: number }
      cameraTarget: { x: number; y: number; z: number }
      beforeChamferSnippet: string
      afterChamferSelectSnippet: string
      afterRectangle1stClickSnippet: string
      afterRectangle2ndClickSnippet: string
      beforeChamferSnippetEnd?: string
    }) => {
      const [clickChamfer] = scene.makeMouseHelpers(
        clickCoords.x,
        clickCoords.y
      )
      const [rectangle1stClick] = scene.makeMouseHelpers(573, 149)
      const [rectangle2ndClick, rectangle2ndMove] = scene.makeMouseHelpers(
        598,
        380,
        { steps: 5 }
      )

      await scene.moveCameraTo(cameraPos, cameraTarget)

      await test.step('check chamfer selection changes cursor positon', async () => {
        await expect(async () => {
          // sometimes initial click doesn't register
          await clickChamfer()
          // await editor.expectActiveLinesToBe([beforeChamferSnippet.slice(-5)])
          await editor.expectActiveLinesToBe([
            beforeChamferSnippetEnd || beforeChamferSnippet.slice(-5),
          ])
        }).toPass({ timeout: 15_000, intervals: [500] })
      })

      await test.step('starting a new and selecting a chamfer should animate to the new sketch and possible break up the initial chamfer if it had one than more tag', async () => {
        await toolbar.startSketchPlaneSelection()
        await clickChamfer()
        // timeout wait for engine animation is unavoidable
        await app.page.waitForTimeout(600)
        await editor.expectEditor.toContain(afterChamferSelectSnippet)
      })
      await test.step('make sure a basic sketch can be added', async () => {
        await toolbar.rectangleBtn.click()
        await rectangle1stClick()
        await editor.expectEditor.toContain(afterRectangle1stClickSnippet)
        await rectangle2ndMove({
          pixelDiff: 50,
        })
        await rectangle2ndClick()
        await editor.expectEditor.toContain(afterRectangle2ndClickSnippet)
      })

      await test.step('Clean up so that `_sketchOnAChamfer` util can be called again', async () => {
        await toolbar.exitSketchBtn.click()
        await scene.waitForExecutionDone()
      })
      await test.step('Check there is no errors after code created in previous steps executes', async () => {
        await editor.expectState({
          activeLines: ["sketch001 = startSketchOn('XZ')"],
          highlightedCode: '',
          diagnostics: [],
        })
      })
    }
  test(
    'works on all edge selections and can break up multi edges in a chamfer array',
    { tag: ['@skipWin'] },
    async ({ app, editor, toolbar, scene }) => {
      test.skip(
        process.platform === 'win32',
        'Fails on windows in CI, can not be replicated locally on windows.'
      )
      const file = await app.getInputFile('e2e-can-sketch-on-chamfer.kcl')
      await app.initialise(file)

      const sketchOnAChamfer = _sketchOnAChamfer(app, editor, toolbar, scene)

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
          'sketch002 = startSketchOn(extrude001, seg03)',
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
          'sketch003 = startSketchOn(extrude001, seg04)',
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
          'sketch003 = startSketchOn(extrude001, seg04)',
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
          'sketch005 = startSketchOn(extrude001, seg06)',
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

      await test.step('verify at the end of the test that final code is what is expected', async () => {
        await editor.expectEditor.toContain(
          `sketch001 = startSketchOn('XZ')

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
    extrude001 = extrude(100, sketch001)
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
    sketch005 = startSketchOn(extrude001, seg06)
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
    sketch004 = startSketchOn(extrude001, seg05)
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
    sketch003 = startSketchOn(extrude001, seg04)
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
    sketch002 = startSketchOn(extrude001, seg03)
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
    }
  )

  test(
    'Works on chamfers that are non in a pipeExpression can break up multi edges in a chamfer array',
    { tag: ['@skipWin'] },
    async ({ app, editor, toolbar, scene }) => {
      test.skip(
        process.platform === 'win32',
        'Fails on windows in CI, can not be replicated locally on windows.'
      )
      const file = await app.getInputFile(
        'e2e-can-sketch-on-chamfer-no-pipeExpr.kcl'
      )
      await app.initialise(file)

      const sketchOnAChamfer = _sketchOnAChamfer(app, editor, toolbar, scene)

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
    ]}, extrude001)`,
        beforeChamferSnippetEnd: '}, extrude001)',
        afterChamferSelectSnippet:
          'sketch002 = startSketchOn(extrude001, seg03)',
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
      await editor.expectEditor.toContain(
        `sketch001 = startSketchOn('XZ')
  |> startProfileAt([75.8, 317.2], %)
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
extrude001 = extrude(100, sketch001)
chamf = chamfer({
       length: 30,
       tags: [getOppositeEdge(seg01)]
     }, extrude001, $seg03)
  |> chamfer({
       length: 30,
       tags: [
         seg01,
         getNextAdjacentEdge(yo),
         getNextAdjacentEdge(seg02)
       ]
     }, %)
sketch002 = startSketchOn(extrude001, seg03)
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
    }
  )
})

test(`Verify axis and origin snapping`, async ({
  app,
  editor,
  toolbar,
  scene,
}) => {
  // Constants and locators
  // These are mappings from screenspace to KCL coordinates,
  // until we merge in our coordinate system helpers
  const xzPlane = [
    app.viewPortSize.width * 0.65,
    app.viewPortSize.height * 0.3,
  ] as const
  const originSloppy = {
    screen: [
      app.viewPortSize.width / 2 + 3, // 3px off the center of the screen
      app.viewPortSize.height / 2,
    ],
    kcl: [0, 0],
  } as const
  const xAxisSloppy = {
    screen: [
      app.viewPortSize.width * 0.75,
      app.viewPortSize.height / 2 - 3, // 3px off the X-axis
    ],
    kcl: [16.95, 0],
  } as const
  const offYAxis = {
    screen: [
      app.viewPortSize.width * 0.6, // Well off the Y-axis, out of snapping range
      app.viewPortSize.height * 0.3,
    ],
    kcl: [6.78, 6.78],
  } as const
  const yAxisSloppy = {
    screen: [
      app.viewPortSize.width / 2 + 5, // 5px off the Y-axis
      app.viewPortSize.height * 0.3,
    ],
    kcl: [0, 6.78],
  } as const
  const [clickOnXzPlane, moveToXzPlane] = scene.makeMouseHelpers(...xzPlane)
  const [clickOriginSloppy] = scene.makeMouseHelpers(...originSloppy.screen)
  const [clickXAxisSloppy, moveXAxisSloppy] = scene.makeMouseHelpers(
    ...xAxisSloppy.screen
  )
  const [dragToOffYAxis, dragFromOffAxis] = scene.makeDragHelpers(
    ...offYAxis.screen
  )

  const expectedCodeSnippets = {
    sketchOnXzPlane: `sketch001 = startSketchOn('XZ')`,
    pointAtOrigin: `startProfileAt([${originSloppy.kcl[0]}, ${originSloppy.kcl[1]}], %)`,
    segmentOnXAxis: `line([${xAxisSloppy.kcl[0]}, ${xAxisSloppy.kcl[1]}], %)`,
    afterSegmentDraggedOffYAxis: `startProfileAt([${offYAxis.kcl[0]}, ${offYAxis.kcl[1]}], %)`,
    afterSegmentDraggedOnYAxis: `startProfileAt([${yAxisSloppy.kcl[0]}, ${yAxisSloppy.kcl[1]}], %)`,
  }

  await app.initialise()

  await test.step(`Start a sketch on the XZ plane`, async () => {
    await editor.closePane()
    await toolbar.startSketchPlaneSelection()
    await moveToXzPlane()
    await clickOnXzPlane()
    // timeout wait for engine animation is unavoidable
    await app.page.waitForTimeout(600)
    await editor.expectEditor.toContain(expectedCodeSnippets.sketchOnXzPlane)
  })
  await test.step(`Place a point a few pixels off the middle, verify it still snaps to 0,0`, async () => {
    await clickOriginSloppy()
    await editor.expectEditor.toContain(expectedCodeSnippets.pointAtOrigin)
  })
  await test.step(`Add a segment on x-axis after moving the mouse a bit, verify it snaps`, async () => {
    await moveXAxisSloppy()
    await clickXAxisSloppy()
    await editor.expectEditor.toContain(expectedCodeSnippets.segmentOnXAxis)
  })
  await test.step(`Unequip line tool`, async () => {
    await toolbar.lineBtn.click()
    await expect(toolbar.lineBtn).not.toHaveAttribute('aria-pressed', 'true')
  })
  await test.step(`Drag the origin point up and to the right, verify it's past snapping`, async () => {
    await dragToOffYAxis({
      fromPoint: { x: originSloppy.screen[0], y: originSloppy.screen[1] },
    })
    await editor.expectEditor.toContain(
      expectedCodeSnippets.afterSegmentDraggedOffYAxis
    )
  })
  await test.step(`Drag the origin point left to the y-axis, verify it snaps back`, async () => {
    await dragFromOffAxis({
      toPoint: { x: yAxisSloppy.screen[0], y: yAxisSloppy.screen[1] },
    })
    await editor.expectEditor.toContain(
      expectedCodeSnippets.afterSegmentDraggedOnYAxis
    )
  })
})
