import { test, expect, Page } from './zoo-test'
import { EditorFixture } from './fixtures/editorFixture'
import { SceneFixture } from './fixtures/sceneFixture'
import { ToolbarFixture } from './fixtures/toolbarFixture'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getUtils } from './test-utils'

// test file is for testing point an click code gen functionality that's not sketch mode related

test('verify extruding circle works', async ({
  context,
  homePage,
  cmdBar,
  editor,
  toolbar,
  scene,
}) => {
  // TODO: fix this test on windows after the electron migration
  test.skip(process.platform === 'win32', 'Skip on windows')
  const file = await fs.readFile(
    path.resolve(
      __dirname,
      '../../',
      './src/wasm-lib/tests/executor/inputs/test-circle-extrude.kcl'
    ),
    'utf-8'
  )
  await context.addInitScript((file) => {
    localStorage.setItem('persistCode', file)
  }, file)
  await homePage.goToModelingScene()
  await scene.waitForExecutionDone()

  const [clickCircle, moveToCircle] = scene.makeMouseHelpers(582, 217)

  await test.step('because there is sweepable geometry, verify extrude is enable when nothing is selected', async () => {
    // FIXME: Do not click, clicking removes the activeLines in future checks
    // await scene.clickNoWhere()
    await expect(toolbar.extrudeButton).toBeEnabled()
  })

  await test.step('check code model connection works and that button is still enable once circle is selected ', async () => {
    await moveToCircle()
    const circleSnippet =
      'circle({ center = [318.33, 168.1], radius = 182.8 }, %)'
    await editor.expectState({
      activeLines: ["constsketch002=startSketchOn('XZ')"],
      highlightedCode: circleSnippet,
      diagnostics: [],
    })

    await test.step('check code model connection works and that button is still enable once circle is selected ', async () => {
      await moveToCircle()
      const circleSnippet =
        'circle({ center = [318.33, 168.1], radius = 182.8 }, %)'
      await editor.expectState({
        activeLines: ["constsketch002=startSketchOn('XZ')"],
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

    const expectString = 'extrude001 = extrude(sketch001, length = 5)'
    await editor.expectEditor.not.toContain(expectString)

    await cmdBar.expectState({
      stage: 'review',
      headerArguments: { Selection: '1 face', Distance: '5' },
      commandName: 'Extrude',
    })
    await cmdBar.progressCmdBar()

    await editor.expectEditor.toContain(expectString)
  })
})

test.describe('verify sketch on chamfer works', () => {
  // TODO: fix this test on windows after the electron migration
  test.skip(process.platform === 'win32', 'Skip on windows')
  const _sketchOnAChamfer =
    (
      page: Page,
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
        await page.waitForTimeout(1000)
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
        await editor.expectEditor.toContain(afterRectangle2ndClickSnippet, {
          shouldNormalise: true,
        })
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
  test('works on all edge selections and can break up multi edges in a chamfer array', async ({
    context,
    page,
    homePage,
    editor,
    toolbar,
    scene,
  }) => {
    const file = await fs.readFile(
      path.resolve(
        __dirname,
        '../../',
        './src/wasm-lib/tests/executor/inputs/e2e-can-sketch-on-chamfer.kcl'
      ),
      'utf-8'
    )
    await context.addInitScript((file) => {
      localStorage.setItem('persistCode', file)
    }, file)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    const sketchOnAChamfer = _sketchOnAChamfer(page, editor, toolbar, scene)

    await sketchOnAChamfer({
      clickCoords: { x: 570, y: 220 },
      cameraPos: { x: 16020, y: -2000, z: 10500 },
      cameraTarget: { x: -150, y: -4500, z: -80 },
      beforeChamferSnippet: `angledLine([segAng(rectangleSegmentA001)-90,217.26],%,$seg01)
      chamfer({length = 30,tags = [
      seg01,
      getNextAdjacentEdge(yo),
      getNextAdjacentEdge(seg02),
      getOppositeEdge(seg01)
    ]}, %)`,

      afterChamferSelectSnippet: 'sketch002 = startSketchOn(extrude001, seg03)',
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
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`,
    })

    await sketchOnAChamfer({
      clickCoords: { x: 690, y: 250 },
      cameraPos: { x: 16020, y: -2000, z: 10500 },
      cameraTarget: { x: -150, y: -4500, z: -80 },
      beforeChamferSnippet: `angledLine([
         segAng(rectangleSegmentA001) - 90,
         217.26
       ], %, $seg01)chamfer({
         length = 30,
         tags = [
           seg01,
           getNextAdjacentEdge(yo),
           getNextAdjacentEdge(seg02)
         ]
       }, %)`,

      afterChamferSelectSnippet: 'sketch003 = startSketchOn(extrude001, seg04)',
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
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`,
    })
    await sketchOnAChamfer({
      clickCoords: { x: 677, y: 87 },
      cameraPos: { x: -6200, y: 1500, z: 6200 },
      cameraTarget: { x: 8300, y: 1100, z: 4800 },
      beforeChamferSnippet: `angledLine([0, 268.43], %, $rectangleSegmentA001)chamfer({
         length = 30,
         tags = [
           getNextAdjacentEdge(yo),
           getNextAdjacentEdge(seg02)
         ]
       }, %)`,
      afterChamferSelectSnippet: 'sketch003 = startSketchOn(extrude001, seg04)',
      afterRectangle1stClickSnippet: 'startProfileAt([75.8, 317.2], %)',
      afterRectangle2ndClickSnippet: `angledLine([0, 11.56], %, $rectangleSegmentA003)
    |> angledLine([
         segAng(rectangleSegmentA003) - 90,
         106.84
       ], %, $rectangleSegmentB002)
    |> angledLine([
         segAng(rectangleSegmentA003),
         -segLen(rectangleSegmentA003)
       ], %, $rectangleSegmentC002)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`,
    })
    /// last one
    await sketchOnAChamfer({
      clickCoords: { x: 620, y: 300 },
      cameraPos: { x: -1100, y: -7700, z: 1600 },
      cameraTarget: { x: 1450, y: 670, z: 4000 },
      beforeChamferSnippet: `chamfer({
         length = 30,
         tags = [getNextAdjacentEdge(yo)]
       }, %)`,
      afterChamferSelectSnippet: 'sketch005 = startSketchOn(extrude001, seg06)',
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
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`,
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
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
      |> close()
    extrude001 = extrude(sketch001, length = 100)
      |> chamfer({
           length = 30,
           tags = [getOppositeEdge(seg01)]
         }, %, $seg03)
      |> chamfer({ length = 30, tags = [seg01] }, %, $seg04)
      |> chamfer({
           length = 30,
           tags = [getNextAdjacentEdge(seg02)]
         }, %, $seg05)
      |> chamfer({
           length = 30,
           tags = [getNextAdjacentEdge(yo)]
         }, %, $seg06)
    sketch005 = startSketchOn(extrude001, seg06)
      |> startProfileAt([-23.43,19.69], %)
      |> angledLine([0, 9.1], %, $rectangleSegmentA005)
      |> angledLine([
           segAng(rectangleSegmentA005) - 90,
           84.07
         ], %, $rectangleSegmentB004)
      |> angledLine([
           segAng(rectangleSegmentA005),
           -segLen(rectangleSegmentA005)
         ], %, $rectangleSegmentC004)
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    sketch004 = startSketchOn(extrude001, seg05)
      |> startProfileAt([82.57,322.96], %)
      |> angledLine([0, 11.16], %, $rectangleSegmentA004)
      |> angledLine([
           segAng(rectangleSegmentA004) - 90,
           103.07
         ], %, $rectangleSegmentB003)
      |> angledLine([
           segAng(rectangleSegmentA004),
           -segLen(rectangleSegmentA004)
         ], %, $rectangleSegmentC003)
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    sketch003 = startSketchOn(extrude001, seg04)
      |> startProfileAt([-209.64,255.28], %)
      |> angledLine([0, 11.56], %, $rectangleSegmentA003)
      |> angledLine([
           segAng(rectangleSegmentA003) - 90,
           106.84
         ], %, $rectangleSegmentB002)
      |> angledLine([
           segAng(rectangleSegmentA003),
           -segLen(rectangleSegmentA003)
         ], %, $rectangleSegmentC002)
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    sketch002 = startSketchOn(extrude001, seg03)
      |> startProfileAt([205.96,254.59], %)
      |> angledLine([0, 11.39], %, $rectangleSegmentA002)
      |> angledLine([
           segAng(rectangleSegmentA002) - 90,
           105.26
         ], %, $rectangleSegmentB001)
      |> angledLine([
           segAng(rectangleSegmentA002),
           -segLen(rectangleSegmentA002)
         ], %, $rectangleSegmentC001)
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    `,
        { shouldNormalise: true }
      )
    })
  })

  test('Works on chamfers that are non in a pipeExpression can break up multi edges in a chamfer array', async ({
    context,
    page,
    homePage,
    editor,
    toolbar,
    scene,
  }) => {
    const file = await fs.readFile(
      path.resolve(
        __dirname,
        '../../',
        './src/wasm-lib/tests/executor/inputs/e2e-can-sketch-on-chamfer-no-pipeExpr.kcl'
      ),
      'utf-8'
    )
    await context.addInitScript((file) => {
      localStorage.setItem('persistCode', file)
    }, file)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    const sketchOnAChamfer = _sketchOnAChamfer(page, editor, toolbar, scene)

    await sketchOnAChamfer({
      clickCoords: { x: 570, y: 220 },
      cameraPos: { x: 16020, y: -2000, z: 10500 },
      cameraTarget: { x: -150, y: -4500, z: -80 },
      beforeChamferSnippet: `angledLine([segAng(rectangleSegmentA001)-90,217.26],%,$seg01)
      chamfer({length=30,tags=[
      seg01,
      getNextAdjacentEdge(yo),
      getNextAdjacentEdge(seg02),
      getOppositeEdge(seg01)
    ]}, extrude001)`,
      beforeChamferSnippetEnd: '}, extrude001)',
      afterChamferSelectSnippet: 'sketch002 = startSketchOn(extrude001, seg03)',
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
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`,
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
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(sketch001, length = 100)
chamf = chamfer({
       length = 30,
       tags = [getOppositeEdge(seg01)]
     }, extrude001, $seg03)
  |> chamfer({
       length = 30,
       tags = [
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
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`,
      { shouldNormalise: true }
    )
  })
})

test(`Verify axis, origin, and horizontal snapping`, async ({
  page,
  homePage,
  editor,
  toolbar,
  scene,
}) => {
  const viewPortSize = { width: 1200, height: 500 }

  await page.setBodyDimensions(viewPortSize)

  await homePage.goToModelingScene()

  // Constants and locators
  // These are mappings from screenspace to KCL coordinates,
  // until we merge in our coordinate system helpers
  const xzPlane = [
    viewPortSize.width * 0.65,
    viewPortSize.height * 0.3,
  ] as const
  const originSloppy = {
    screen: [
      viewPortSize.width / 2 + 3, // 3px off the center of the screen
      viewPortSize.height / 2,
    ],
    kcl: [0, 0],
  } as const
  const xAxisSloppy = {
    screen: [
      viewPortSize.width * 0.75,
      viewPortSize.height / 2 - 3, // 3px off the X-axis
    ],
    kcl: [20.34, 0],
  } as const
  const offYAxis = {
    screen: [
      viewPortSize.width * 0.6, // Well off the Y-axis, out of snapping range
      viewPortSize.height * 0.3,
    ],
    kcl: [8.14, 6.78],
  } as const
  const yAxisSloppy = {
    screen: [
      viewPortSize.width / 2 + 5, // 5px off the Y-axis
      viewPortSize.height * 0.3,
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
    segmentOnXAxis: `xLine(${xAxisSloppy.kcl[0]}, %)`,
    afterSegmentDraggedOffYAxis: `startProfileAt([${offYAxis.kcl[0]}, ${offYAxis.kcl[1]}], %)`,
    afterSegmentDraggedOnYAxis: `startProfileAt([${yAxisSloppy.kcl[0]}, ${yAxisSloppy.kcl[1]}], %)`,
  }

  await test.step(`Start a sketch on the XZ plane`, async () => {
    await editor.closePane()
    await toolbar.startSketchPlaneSelection()
    await moveToXzPlane()
    await clickOnXzPlane()
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)
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

test(`Verify user can double-click to edit a sketch`, async ({
  context,
  page,
  homePage,
  editor,
  toolbar,
  scene,
}) => {
  const u = await getUtils(page)

  const initialCode = `closedSketch = startSketchOn('XZ')
  |> circle({ center = [8, 5], radius = 2 }, %)
openSketch = startSketchOn('XY')
  |> startProfileAt([-5, 0], %)
  |> line(endAbsolute = [0, 5])
  |> xLine(5, %)
  |> tangentialArcTo([10, 0], %)
`
  const viewPortSize = { width: 1000, height: 500 }
  await page.setBodyDimensions(viewPortSize)

  await context.addInitScript((code) => {
    localStorage.setItem('persistCode', code)
  }, initialCode)

  await homePage.goToModelingScene()
  await u.waitForPageLoad()
  await page.waitForTimeout(1000)

  const pointInsideCircle = {
    x: viewPortSize.width * 0.63,
    y: viewPortSize.height * 0.5,
  }
  const pointOnPathAfterSketching = {
    x: viewPortSize.width * 0.65,
    y: viewPortSize.height * 0.5,
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_clickOpenPath, moveToOpenPath, dblClickOpenPath] =
    scene.makeMouseHelpers(
      pointOnPathAfterSketching.x,
      pointOnPathAfterSketching.y
    )
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_clickCircle, moveToCircle, dblClickCircle] = scene.makeMouseHelpers(
    pointInsideCircle.x,
    pointInsideCircle.y
  )

  const exitSketch = async () => {
    await test.step(`Exit sketch mode`, async () => {
      await toolbar.exitSketchBtn.click()
      await expect(toolbar.exitSketchBtn).not.toBeVisible()
      await expect(toolbar.startSketchBtn).toBeEnabled()
    })
  }

  await test.step(`Double-click on the closed sketch`, async () => {
    await moveToCircle()
    await dblClickCircle()
    await expect(toolbar.startSketchBtn).not.toBeVisible()
    await expect(toolbar.exitSketchBtn).toBeVisible()
    await editor.expectState({
      activeLines: [`|>circle({center=[8,5],radius=2},%)`],
      highlightedCode: 'circle({center=[8,5],radius=2},%)',
      diagnostics: [],
    })
  })
  await page.waitForTimeout(1000)

  await exitSketch()
  await page.waitForTimeout(1000)

  // Drag the sketch line out of the axis view which blocks the click
  await page.dragAndDrop('#stream', '#stream', {
    sourcePosition: {
      x: viewPortSize.width * 0.7,
      y: viewPortSize.height * 0.5,
    },
    targetPosition: {
      x: viewPortSize.width * 0.7,
      y: viewPortSize.height * 0.4,
    },
  })

  await page.waitForTimeout(500)

  await test.step(`Double-click on the open sketch`, async () => {
    await moveToOpenPath()
    await scene.expectPixelColor([250, 250, 250], pointOnPathAfterSketching, 15)
    // There is a full execution after exiting sketch that clears the scene.
    await page.waitForTimeout(500)
    await dblClickOpenPath()
    await expect(toolbar.startSketchBtn).not.toBeVisible()
    await expect(toolbar.exitSketchBtn).toBeVisible()
    // Wait for enter sketch mode to complete
    await page.waitForTimeout(500)
    await editor.expectState({
      activeLines: [`|>tangentialArcTo([10,0],%)`],
      highlightedCode: 'tangentialArcTo([10,0],%)',
      diagnostics: [],
    })
  })
})

test(`Offset plane point-and-click`, async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
  cmdBar,
}) => {
  // One dumb hardcoded screen pixel value
  const testPoint = { x: 700, y: 150 }
  const [clickOnXzPlane] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
  const expectedOutput = `plane001 = offsetPlane('XZ', 5)`

  await homePage.goToModelingScene()

  await test.step(`Look for the blue of the XZ plane`, async () => {
    await scene.expectPixelColor([50, 51, 96], testPoint, 15)
  })
  await test.step(`Go through the command bar flow`, async () => {
    await toolbar.offsetPlaneButton.click()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'plane',
      currentArgValue: '',
      headerArguments: { Plane: '', Distance: '' },
      highlightedHeaderArg: 'plane',
      commandName: 'Offset plane',
    })
    await clickOnXzPlane()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'distance',
      currentArgValue: '5',
      headerArguments: { Plane: '1 plane', Distance: '' },
      highlightedHeaderArg: 'distance',
      commandName: 'Offset plane',
    })
    await cmdBar.progressCmdBar()
  })

  await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
    await editor.expectEditor.toContain(expectedOutput)
    await editor.expectState({
      diagnostics: [],
      activeLines: [expectedOutput],
      highlightedCode: '',
    })
    await scene.expectPixelColor([74, 74, 74], testPoint, 15)
  })

  await test.step('Delete offset plane via feature tree selection', async () => {
    await editor.closePane()
    const operationButton = await toolbar.getFeatureTreeOperation(
      'Offset Plane',
      0
    )
    await operationButton.click({ button: 'left' })
    await page.keyboard.press('Backspace')
    await scene.expectPixelColor([50, 51, 96], testPoint, 15)
  })
})

const loftPointAndClickCases = [
  { shouldPreselect: true },
  { shouldPreselect: false },
]
loftPointAndClickCases.forEach(({ shouldPreselect }) => {
  test(`Loft point-and-click (preselected sketches: ${shouldPreselect})`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn('XZ')
    |> circle({ center = [0, 0], radius = 30 }, %)
    plane001 = offsetPlane('XZ', 50)
    sketch002 = startSketchOn(plane001)
    |> circle({ center = [0, 0], radius = 20 }, %)
`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 575, y: 200 }
    const [clickOnSketch1] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const [clickOnSketch2] = scene.makeMouseHelpers(
      testPoint.x,
      testPoint.y + 80
    )
    const loftDeclaration = 'loft001 = loft([sketch001, sketch002])'

    await test.step(`Look for the white of the sketch001 shape`, async () => {
      await scene.expectPixelColor([254, 254, 254], testPoint, 15)
    })

    async function selectSketches() {
      await clickOnSketch1()
      await page.keyboard.down('Shift')
      await clickOnSketch2()
      await page.waitForTimeout(500)
      await page.keyboard.up('Shift')
    }

    if (!shouldPreselect) {
      await test.step(`Go through the command bar flow without preselected sketches`, async () => {
        await toolbar.loftButton.click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'selection',
          currentArgValue: '',
          headerArguments: { Selection: '' },
          highlightedHeaderArg: 'selection',
          commandName: 'Loft',
        })
        await selectSketches()
        await cmdBar.progressCmdBar()
      })
    } else {
      await test.step(`Preselect the two sketches`, async () => {
        await selectSketches()
      })

      await test.step(`Go through the command bar flow with preselected sketches`, async () => {
        await toolbar.loftButton.click()
        await cmdBar.progressCmdBar()
      })
    }

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await editor.expectEditor.toContain(loftDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [loftDeclaration],
        highlightedCode: '',
      })
      await scene.expectPixelColor([89, 89, 89], testPoint, 15)
    })

    await test.step('Delete loft via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Loft', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Backspace')
      await scene.expectPixelColor([254, 254, 254], testPoint, 15)
    })
  })
})

// TODO: merge with above test. Right now we're not able to delete a loft
// right after creation via selection for some reason, so we go with a new instance
test('Loft and offset plane deletion via selection', async ({
  context,
  page,
  homePage,
  scene,
}) => {
  const initialCode = `sketch001 = startSketchOn('XZ')
  |> circle({ center = [0, 0], radius = 30 }, %)
  plane001 = offsetPlane('XZ', 50)
  sketch002 = startSketchOn(plane001)
  |> circle({ center = [0, 0], radius = 20 }, %)
loft001 = loft([sketch001, sketch002])
`
  await context.addInitScript((initialCode) => {
    localStorage.setItem('persistCode', initialCode)
  }, initialCode)
  await page.setBodyDimensions({ width: 1000, height: 500 })
  await homePage.goToModelingScene()
  await scene.waitForExecutionDone()

  // One dumb hardcoded screen pixel value
  const testPoint = { x: 575, y: 200 }
  const [clickOnSketch1] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
  const [clickOnSketch2] = scene.makeMouseHelpers(testPoint.x, testPoint.y + 80)

  await test.step(`Delete loft`, async () => {
    // Check for loft
    await scene.expectPixelColor([89, 89, 89], testPoint, 15)
    await clickOnSketch1()
    await expect(page.locator('.cm-activeLine')).toHaveText(`
      |> circle({ center = [0, 0], radius = 30 }, %)
    `)
    await page.keyboard.press('Backspace')
    // Check for sketch 1
    await scene.expectPixelColor([254, 254, 254], testPoint, 15)
  })

  await test.step('Delete sketch002', async () => {
    await page.waitForTimeout(1000)
    await clickOnSketch2()
    await expect(page.locator('.cm-activeLine')).toHaveText(`
      |> circle({ center = [0, 0], radius = 20 }, %)
    `)
    await page.keyboard.press('Backspace')
    // Check for plane001
    await scene.expectPixelColor([228, 228, 228], testPoint, 15)
  })

  await test.step('Delete plane001', async () => {
    await page.waitForTimeout(1000)
    await clickOnSketch2()
    await expect(page.locator('.cm-activeLine')).toHaveText(`
      plane001 = offsetPlane('XZ', 50)
    `)
    await page.keyboard.press('Backspace')
    // Check for sketch 1
    await scene.expectPixelColor([254, 254, 254], testPoint, 15)
  })
})

test(`Sweep point-and-click`, async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
  cmdBar,
}) => {
  const initialCode = `sketch001 = startSketchOn('YZ')
  |> circle({
       center = [0, 0],
       radius = 500
     }, %)
sketch002 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> xLine(-500, %)
  |> tangentialArcTo([-2000, 500], %)
`
  await context.addInitScript((initialCode) => {
    localStorage.setItem('persistCode', initialCode)
  }, initialCode)
  await page.setBodyDimensions({ width: 1000, height: 500 })
  await homePage.goToModelingScene()
  await scene.waitForExecutionDone()

  // One dumb hardcoded screen pixel value
  const testPoint = { x: 700, y: 250 }
  const [clickOnSketch1] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
  const [clickOnSketch2] = scene.makeMouseHelpers(testPoint.x - 50, testPoint.y)
  const sweepDeclaration = 'sweep001 = sweep({ path = sketch002 }, sketch001)'

  await test.step(`Look for sketch001`, async () => {
    await toolbar.closePane('code')
    await scene.expectPixelColor([53, 53, 53], testPoint, 15)
  })

  await test.step(`Go through the command bar flow`, async () => {
    await toolbar.sweepButton.click()
    await cmdBar.expectState({
      commandName: 'Sweep',
      currentArgKey: 'target',
      currentArgValue: '',
      headerArguments: {
        Target: '',
        Trajectory: '',
      },
      highlightedHeaderArg: 'target',
      stage: 'arguments',
    })
    await clickOnSketch1()
    await cmdBar.expectState({
      commandName: 'Sweep',
      currentArgKey: 'trajectory',
      currentArgValue: '',
      headerArguments: {
        Target: '1 face',
        Trajectory: '',
      },
      highlightedHeaderArg: 'trajectory',
      stage: 'arguments',
    })
    await clickOnSketch2()
    await page.waitForTimeout(500)
    await cmdBar.progressCmdBar()
    await page.waitForTimeout(500)
  })

  await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
    await scene.expectPixelColor([135, 64, 73], testPoint, 15)
    await toolbar.openPane('code')
    await editor.expectEditor.toContain(sweepDeclaration)
    await editor.expectState({
      diagnostics: [],
      activeLines: [sweepDeclaration],
      highlightedCode: '',
    })
    await toolbar.closePane('code')
  })

  await test.step('Delete sweep via feature tree selection', async () => {
    await toolbar.openPane('feature-tree')
    await page.waitForTimeout(500)
    const operationButton = await toolbar.getFeatureTreeOperation('Sweep', 0)
    await operationButton.click({ button: 'left' })
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(500)
    await toolbar.closePane('feature-tree')
    await scene.expectPixelColor([53, 53, 53], testPoint, 15)
  })
})

test(`Sweep point-and-click failing validation`, async ({
  context,
  page,
  homePage,
  scene,
  toolbar,
  cmdBar,
}) => {
  const initialCode = `sketch001 = startSketchOn('YZ')
  |> circle({
       center = [0, 0],
       radius = 500
     }, %)
sketch002 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> xLine(-500, %)
  |> line(endAbsolute = [-2000, 500])
`
  await context.addInitScript((initialCode) => {
    localStorage.setItem('persistCode', initialCode)
  }, initialCode)
  await page.setBodyDimensions({ width: 1000, height: 500 })
  await homePage.goToModelingScene()
  await scene.waitForExecutionDone()

  // One dumb hardcoded screen pixel value
  const testPoint = { x: 700, y: 250 }
  const [clickOnSketch1] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
  const [clickOnSketch2] = scene.makeMouseHelpers(testPoint.x - 50, testPoint.y)

  await test.step(`Look for sketch001`, async () => {
    await toolbar.closePane('code')
    await scene.expectPixelColor([53, 53, 53], testPoint, 15)
  })

  await test.step(`Go through the command bar flow and fail validation with a toast`, async () => {
    await toolbar.sweepButton.click()
    await cmdBar.expectState({
      commandName: 'Sweep',
      currentArgKey: 'target',
      currentArgValue: '',
      headerArguments: {
        Target: '',
        Trajectory: '',
      },
      highlightedHeaderArg: 'target',
      stage: 'arguments',
    })
    await clickOnSketch1()
    await cmdBar.expectState({
      commandName: 'Sweep',
      currentArgKey: 'trajectory',
      currentArgValue: '',
      headerArguments: {
        Target: '1 face',
        Trajectory: '',
      },
      highlightedHeaderArg: 'trajectory',
      stage: 'arguments',
    })
    await clickOnSketch2()
    await page.waitForTimeout(500)
    await cmdBar.progressCmdBar()
    await expect(
      page.getByText('Unable to sweep with the current selection. Reason:')
    ).toBeVisible()
  })
})

test(`Fillet point-and-click`, async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
  cmdBar,
}) => {
  // Code samples
  const initialCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-12, -6], %)
  |> line(end = [0, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -12)
`
  const firstFilletDeclaration = 'fillet({ radius = 5, tags = [seg01] }, %)'
  const secondFilletDeclaration =
    'fillet({       radius = 5,       tags = [getOppositeEdge(seg01)]     }, %)'

  // Locators
  const firstEdgeLocation = { x: 600, y: 193 }
  const secondEdgeLocation = { x: 600, y: 383 }
  const bodyLocation = { x: 630, y: 290 }
  const [clickOnFirstEdge] = scene.makeMouseHelpers(
    firstEdgeLocation.x,
    firstEdgeLocation.y
  )
  const [clickOnSecondEdge] = scene.makeMouseHelpers(
    secondEdgeLocation.x,
    secondEdgeLocation.y
  )

  // Colors
  const edgeColorWhite: [number, number, number] = [248, 248, 248]
  const edgeColorYellow: [number, number, number] = [251, 251, 40] // Mac:B=67 Ubuntu:B=12
  const bodyColor: [number, number, number] = [155, 155, 155]
  const filletColor: [number, number, number] = [127, 127, 127]
  const backgroundColor: [number, number, number] = [30, 30, 30]
  const lowTolerance = 20
  const highTolerance = 40

  // Setup
  await test.step(`Initial test setup`, async () => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()

    // verify modeling scene is loaded
    await scene.expectPixelColor(
      backgroundColor,
      secondEdgeLocation,
      lowTolerance
    )

    // wait for stream to load
    await scene.expectPixelColor(bodyColor, bodyLocation, highTolerance)
  })

  // Test 1: Command bar flow with preselected edges
  await test.step(`Select first edge`, async () => {
    await scene.expectPixelColor(
      edgeColorWhite,
      firstEdgeLocation,
      lowTolerance
    )
    await clickOnFirstEdge()
    await scene.expectPixelColor(
      edgeColorYellow,
      firstEdgeLocation,
      highTolerance // Ubuntu color mismatch can require high tolerance
    )
  })

  await test.step(`Apply fillet to the preselected edge`, async () => {
    await page.waitForTimeout(100)
    await toolbar.filletButton.click()
    await cmdBar.expectState({
      commandName: 'Fillet',
      highlightedHeaderArg: 'selection',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Radius: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Fillet',
      highlightedHeaderArg: 'radius',
      currentArgKey: 'radius',
      currentArgValue: '5',
      headerArguments: {
        Selection: '1 segment',
        Radius: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Fillet',
      headerArguments: {
        Selection: '1 segment',
        Radius: '5',
      },
      stage: 'review',
    })
    await cmdBar.progressCmdBar()
  })

  await test.step(`Confirm code is added to the editor`, async () => {
    await editor.expectEditor.toContain(firstFilletDeclaration)
    await editor.expectState({
      diagnostics: [],
      activeLines: ['|>fillet({radius=5,tags=[seg01]},%)'],
      highlightedCode: '',
    })
  })

  await test.step(`Confirm scene has changed`, async () => {
    await scene.expectPixelColor(filletColor, firstEdgeLocation, lowTolerance)
  })

  // Test 2: Command bar flow without preselected edges
  await test.step(`Open fillet UI without selecting edges`, async () => {
    await page.waitForTimeout(100)
    await toolbar.filletButton.click()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Radius: '',
      },
      highlightedHeaderArg: 'selection',
      commandName: 'Fillet',
    })
  })

  await test.step(`Select second edge`, async () => {
    await scene.expectPixelColor(
      edgeColorWhite,
      secondEdgeLocation,
      lowTolerance
    )
    await clickOnSecondEdge()
    await scene.expectPixelColor(
      edgeColorYellow,
      secondEdgeLocation,
      highTolerance // Ubuntu color mismatch can require high tolerance
    )
  })

  await test.step(`Apply fillet to the second edge`, async () => {
    await cmdBar.expectState({
      commandName: 'Fillet',
      highlightedHeaderArg: 'selection',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Radius: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Fillet',
      highlightedHeaderArg: 'radius',
      currentArgKey: 'radius',
      currentArgValue: '5',
      headerArguments: {
        Selection: '1 sweepEdge',
        Radius: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Fillet',
      headerArguments: {
        Selection: '1 sweepEdge',
        Radius: '5',
      },
      stage: 'review',
    })
    await cmdBar.progressCmdBar()
  })

  await test.step(`Confirm code is added to the editor`, async () => {
    await editor.expectEditor.toContain(secondFilletDeclaration)
    await editor.expectState({
      diagnostics: [],
      activeLines: ['radius=5,'],
      highlightedCode: '',
    })
  })

  await test.step(`Confirm scene has changed`, async () => {
    await scene.expectPixelColor(
      backgroundColor,
      secondEdgeLocation,
      lowTolerance
    )
  })

  // Test 3: Delete fillets
  await test.step('Delete fillet via feature tree selection', async () => {
    await test.step('Open Feature Tree Pane', async () => {
      await toolbar.openPane('feature-tree')
      await page.waitForTimeout(500)
    })
    await test.step('Delete fillet via feature tree selection', async () => {
      await editor.expectEditor.toContain(secondFilletDeclaration)
      const operationButton = await toolbar.getFeatureTreeOperation('Fillet', 1)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Backspace')
      await page.waitForTimeout(500)
      await scene.expectPixelColor(edgeColorWhite, secondEdgeLocation, 15) // deleted
      await editor.expectEditor.not.toContain(secondFilletDeclaration)
      await scene.expectPixelColor(filletColor, firstEdgeLocation, 15) // stayed
    })
  })
})

test(`Fillet point-and-click delete`, async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
}) => {
  // Code samples
  const initialCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-12, -6], %)
  |> line(end = [0, 12])
  |> line(end = [24, 0], tag = $seg02)
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(sketch001, length = -12)
  |> fillet({ radius = 5, tags = [seg01] }, %) // fillet01
  |> fillet({ radius = 5, tags = [seg02] }, %) // fillet02
fillet03 = fillet({  radius = 5,  tags = [getOppositeEdge(seg01)]}, extrude001)
fillet04 = fillet({  radius = 5,  tags = [getOppositeEdge(seg02)]}, extrude001)
`
  const pipedFilletDeclaration = 'fillet({ radius = 5, tags = [seg01] }, %)'
  const secondPipedFilletDeclaration =
    'fillet({ radius = 5, tags = [seg02] }, %)'
  const standaloneFilletDeclaration =
    'fillet03 = fillet({  radius = 5,  tags = [getOppositeEdge(seg01)]}, extrude001)'
  const secondStandaloneFilletDeclaration =
    'fillet04 = fillet({  radius = 5,  tags = [getOppositeEdge(seg02)]}, extrude001)'

  // Locators
  const pipedFilletEdgeLocation = { x: 600, y: 193 }
  const standaloneFilletEdgeLocation = { x: 600, y: 383 }
  const bodyLocation = { x: 630, y: 290 }

  // Colors
  const edgeColorWhite: [number, number, number] = [248, 248, 248]
  const bodyColor: [number, number, number] = [155, 155, 155]
  const filletColor: [number, number, number] = [127, 127, 127]
  const backgroundColor: [number, number, number] = [30, 30, 30]
  const lowTolerance = 20
  const highTolerance = 40

  // Setup
  await test.step(`Initial test setup`, async () => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()

    // verify modeling scene is loaded
    await scene.expectPixelColor(
      backgroundColor,
      standaloneFilletEdgeLocation,
      lowTolerance
    )

    // wait for stream to load
    await scene.expectPixelColor(bodyColor, bodyLocation, highTolerance)
  })

  // Test
  await test.step('Delete fillet via feature tree selection', async () => {
    await test.step('Open Feature Tree Pane', async () => {
      await toolbar.openPane('feature-tree')
      await page.waitForTimeout(500)
    })

    await test.step('Delete piped fillet via feature tree selection', async () => {
      await test.step('Verify all fillets are present in the editor', async () => {
        await editor.expectEditor.toContain(pipedFilletDeclaration)
        await editor.expectEditor.toContain(secondPipedFilletDeclaration)
        await editor.expectEditor.toContain(standaloneFilletDeclaration)
        await editor.expectEditor.toContain(secondStandaloneFilletDeclaration)
      })
      await test.step('Verify test fillets are present in the scene', async () => {
        await scene.expectPixelColor(
          filletColor,
          pipedFilletEdgeLocation,
          lowTolerance
        )
        await scene.expectPixelColor(
          backgroundColor,
          standaloneFilletEdgeLocation,
          lowTolerance
        )
      })
      await test.step('Delete piped fillet', async () => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Fillet',
          0
        )
        await operationButton.click({ button: 'left' })
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(500)
      })
      await test.step('Verify piped fillet is deleted but other fillets are not (in the editor)', async () => {
        await editor.expectEditor.not.toContain(pipedFilletDeclaration)
        await editor.expectEditor.toContain(secondPipedFilletDeclaration)
        await editor.expectEditor.toContain(standaloneFilletDeclaration)
        await editor.expectEditor.toContain(secondStandaloneFilletDeclaration)
      })
      await test.step('Verify piped fillet is deleted but non-piped is not (in the scene)', async () => {
        await scene.expectPixelColor(
          edgeColorWhite, // you see edge because fillet is deleted
          pipedFilletEdgeLocation,
          lowTolerance
        )
        await scene.expectPixelColor(
          backgroundColor, // you see background because fillet is not deleted
          standaloneFilletEdgeLocation,
          lowTolerance
        )
      })
    })

    await test.step('Delete non-piped fillet via feature tree selection', async () => {
      await test.step('Delete non-piped fillet', async () => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Fillet',
          1
        )
        await operationButton.click({ button: 'left' })
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(500)
      })
      await test.step('Verify non-piped fillet is deleted but other two fillets are not (in the editor)', async () => {
        await editor.expectEditor.toContain(secondPipedFilletDeclaration)
        await editor.expectEditor.not.toContain(standaloneFilletDeclaration)
        await editor.expectEditor.toContain(secondStandaloneFilletDeclaration)
      })
      await test.step('Verify non-piped fillet is deleted but piped is not (in the scene)', async () => {
        await scene.expectPixelColor(
          edgeColorWhite,
          standaloneFilletEdgeLocation,
          lowTolerance
        )
      })
    })
  })
})

test(`Chamfer point-and-click`, async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
  cmdBar,
}) => {
  // Code samples
  const initialCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-12, -6], %)
  |> line(end = [0, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -12)
`
  const firstChamferDeclaration = 'chamfer({ length = 5, tags = [seg01] }, %)'
  const secondChamferDeclaration =
    'chamfer({       length = 5,       tags = [getOppositeEdge(seg01)]     }, %)'

  // Locators
  const firstEdgeLocation = { x: 600, y: 193 }
  const secondEdgeLocation = { x: 600, y: 383 }
  const bodyLocation = { x: 630, y: 290 }
  const [clickOnFirstEdge] = scene.makeMouseHelpers(
    firstEdgeLocation.x,
    firstEdgeLocation.y
  )
  const [clickOnSecondEdge] = scene.makeMouseHelpers(
    secondEdgeLocation.x,
    secondEdgeLocation.y
  )

  // Colors
  const edgeColorWhite: [number, number, number] = [248, 248, 248]
  const edgeColorYellow: [number, number, number] = [251, 251, 40] // Mac:B=67 Ubuntu:B=12
  const bodyColor: [number, number, number] = [155, 155, 155]
  const chamferColor: [number, number, number] = [168, 168, 168]
  const backgroundColor: [number, number, number] = [30, 30, 30]
  const lowTolerance = 20
  const highTolerance = 40

  // Setup
  await test.step(`Initial test setup`, async () => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()
  })

  // Test 1: Command bar flow with preselected edges
  await test.step(`Select first edge`, async () => {
    await scene.expectPixelColor(
      edgeColorWhite,
      firstEdgeLocation,
      lowTolerance
    )
    await clickOnFirstEdge()
    await scene.expectPixelColor(
      edgeColorYellow,
      firstEdgeLocation,
      highTolerance // Ubuntu color mismatch can require high tolerance
    )
  })

  await test.step(`Apply chamfer to the preselected edge`, async () => {
    await page.waitForTimeout(100)
    await toolbar.chamferButton.click()
    await cmdBar.expectState({
      commandName: 'Chamfer',
      highlightedHeaderArg: 'selection',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Length: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Chamfer',
      highlightedHeaderArg: 'length',
      currentArgKey: 'length',
      currentArgValue: '5',
      headerArguments: {
        Selection: '1 segment',
        Length: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Chamfer',
      headerArguments: {
        Selection: '1 segment',
        Length: '5',
      },
      stage: 'review',
    })
    await cmdBar.progressCmdBar()
  })

  await test.step(`Confirm code is added to the editor`, async () => {
    await editor.expectEditor.toContain(firstChamferDeclaration)
    await editor.expectState({
      diagnostics: [],
      activeLines: ['|>chamfer({length=5,tags=[seg01]},%)'],
      highlightedCode: '',
    })
  })

  await test.step(`Confirm scene has changed`, async () => {
    await scene.expectPixelColor(chamferColor, firstEdgeLocation, lowTolerance)
  })

  // Test 2: Command bar flow without preselected edges
  await test.step(`Open chamfer UI without selecting edges`, async () => {
    await page.waitForTimeout(100)
    await toolbar.chamferButton.click()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Length: '',
      },
      highlightedHeaderArg: 'selection',
      commandName: 'Chamfer',
    })
  })

  await test.step(`Select second edge`, async () => {
    await scene.expectPixelColor(
      edgeColorWhite,
      secondEdgeLocation,
      lowTolerance
    )
    await clickOnSecondEdge()
    await scene.expectPixelColor(
      edgeColorYellow,
      secondEdgeLocation,
      highTolerance // Ubuntu color mismatch can require high tolerance
    )
  })

  await test.step(`Apply chamfer to the second edge`, async () => {
    await cmdBar.expectState({
      commandName: 'Chamfer',
      highlightedHeaderArg: 'selection',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Length: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Chamfer',
      highlightedHeaderArg: 'length',
      currentArgKey: 'length',
      currentArgValue: '5',
      headerArguments: {
        Selection: '1 sweepEdge',
        Length: '',
      },
      stage: 'arguments',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      commandName: 'Chamfer',
      headerArguments: {
        Selection: '1 sweepEdge',
        Length: '5',
      },
      stage: 'review',
    })
    await cmdBar.progressCmdBar()
  })

  await test.step(`Confirm code is added to the editor`, async () => {
    await editor.expectEditor.toContain(secondChamferDeclaration)
    await editor.expectState({
      diagnostics: [],
      activeLines: ['length=5,'],
      highlightedCode: '',
    })
  })

  await test.step(`Confirm scene has changed`, async () => {
    await scene.expectPixelColor(
      backgroundColor,
      secondEdgeLocation,
      lowTolerance
    )
  })

  // Test 3: Delete chamfer via feature tree selection
  await test.step('Open Feature Tree Pane', async () => {
    await toolbar.openPane('feature-tree')
    await page.waitForTimeout(500)
  })
  await test.step('Delete chamfer via feature tree selection', async () => {
    const operationButton = await toolbar.getFeatureTreeOperation('Chamfer', 1)
    await operationButton.click({ button: 'left' })
    await page.keyboard.press('Backspace')
    await page.waitForTimeout(500)
    await scene.expectPixelColor(edgeColorWhite, secondEdgeLocation, 15) // deleted
    await scene.expectPixelColor(chamferColor, firstEdgeLocation, 15) // stayed
  })
})

test(`Chamfer point-and-click delete`, async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
}) => {
  // Code samples
  const initialCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-12, -6], %)
  |> line(end = [0, 12])
  |> line(end = [24, 0], tag = $seg02)
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(sketch001, length = -12)
  |> chamfer({ length = 5, tags = [seg01] }, %) // chamfer01
  |> chamfer({ length = 5, tags = [seg02] }, %) // chamfer02
chamfer03 = chamfer({  length = 5,  tags = [getOppositeEdge(seg01)]}, extrude001)
chamfer04 = chamfer({  length = 5,  tags = [getOppositeEdge(seg02)]}, extrude001)
`
  const pipedChamferDeclaration = 'chamfer({ length = 5, tags = [seg01] }, %)'
  const secondPipedChamferDeclaration =
    'chamfer({ length = 5, tags = [seg02] }, %)'
  const standaloneChamferDeclaration =
    'chamfer03 = chamfer({  length = 5,  tags = [getOppositeEdge(seg01)]}, extrude001)'
  const secondStandaloneChamferDeclaration =
    'chamfer04 = chamfer({  length = 5,  tags = [getOppositeEdge(seg02)]}, extrude001)'

  // Locators
  const pipedChamferEdgeLocation = { x: 600, y: 193 }
  const standaloneChamferEdgeLocation = { x: 600, y: 383 }
  const bodyLocation = { x: 630, y: 290 }

  // Colors
  const edgeColorWhite: [number, number, number] = [248, 248, 248]
  const bodyColor: [number, number, number] = [155, 155, 155]
  const chamferColor: [number, number, number] = [168, 168, 168]
  const backgroundColor: [number, number, number] = [30, 30, 30]
  const lowTolerance = 20
  const highTolerance = 40

  // Setup
  await test.step(`Initial test setup`, async () => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    // verify modeling scene is loaded
    await scene.expectPixelColor(
      backgroundColor,
      standaloneChamferEdgeLocation,
      lowTolerance
    )

    // wait for stream to load
    await scene.expectPixelColor(bodyColor, bodyLocation, highTolerance)
  })

  // Test
  await test.step('Delete chamfer via feature tree selection', async () => {
    await test.step('Open Feature Tree Pane', async () => {
      await toolbar.openPane('feature-tree')
      await page.waitForTimeout(500)
    })

    await test.step('Delete piped chamfer via feature tree selection', async () => {
      await test.step('Verify all chamfers are present in the editor', async () => {
        await editor.expectEditor.toContain(pipedChamferDeclaration)
        await editor.expectEditor.toContain(secondPipedChamferDeclaration)
        await editor.expectEditor.toContain(standaloneChamferDeclaration)
        await editor.expectEditor.toContain(secondStandaloneChamferDeclaration)
      })
      await test.step('Verify test chamfers are present in the scene', async () => {
        await scene.expectPixelColor(
          chamferColor,
          pipedChamferEdgeLocation,
          lowTolerance
        )
        await scene.expectPixelColor(
          backgroundColor,
          standaloneChamferEdgeLocation,
          lowTolerance
        )
      })
      await test.step('Delete piped chamfer', async () => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Chamfer',
          0
        )
        await operationButton.click({ button: 'left' })
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(500)
      })
      await test.step('Verify piped chamfer is deleted but other chamfers are not (in the editor)', async () => {
        await editor.expectEditor.not.toContain(pipedChamferDeclaration)
        await editor.expectEditor.toContain(secondPipedChamferDeclaration)
        await editor.expectEditor.toContain(standaloneChamferDeclaration)
        await editor.expectEditor.toContain(secondStandaloneChamferDeclaration)
      })
      await test.step('Verify piped chamfer is deleted but non-piped is not (in the scene)', async () => {
        await scene.expectPixelColor(
          edgeColorWhite, // you see edge color because chamfer is deleted
          pipedChamferEdgeLocation,
          lowTolerance
        )
        await scene.expectPixelColor(
          backgroundColor, // you see background color instead of edge because it's chamfered
          standaloneChamferEdgeLocation,
          lowTolerance
        )
      })
    })

    await test.step('Delete non-piped chamfer via feature tree selection', async () => {
      await test.step('Delete non-piped chamfer', async () => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Chamfer',
          1
        )
        await operationButton.click({ button: 'left' })
        await page.keyboard.press('Backspace')
        await page.waitForTimeout(500)
      })
      await test.step('Verify non-piped chamfer is deleted but other two chamfers are not (in the editor)', async () => {
        await editor.expectEditor.toContain(secondPipedChamferDeclaration)
        await editor.expectEditor.not.toContain(standaloneChamferDeclaration)
        await editor.expectEditor.toContain(secondStandaloneChamferDeclaration)
      })
      await test.step('Verify non-piped chamfer is deleted but piped is not (in the scene)', async () => {
        await scene.expectPixelColor(
          edgeColorWhite,
          standaloneChamferEdgeLocation,
          lowTolerance
        )
      })
    })
  })
})

const shellPointAndClickCapCases = [
  { shouldPreselect: true },
  { shouldPreselect: false },
]
shellPointAndClickCapCases.forEach(({ shouldPreselect }) => {
  test(`Shell point-and-click cap (preselected sketches: ${shouldPreselect})`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    // TODO: fix this test on windows after the electron migration
    test.skip(process.platform === 'win32', 'Skip on windows')
    const initialCode = `sketch001 = startSketchOn('XZ')
    |> circle({ center = [0, 0], radius = 30 }, %)
    extrude001 = extrude(sketch001, length = 30)
    `
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 575, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const shellDeclaration =
      "shell001 = shell({ faces = ['end'], thickness = 5 }, extrude001)"

    await test.step(`Look for the grey of the shape`, async () => {
      await scene.expectPixelColor([127, 127, 127], testPoint, 15)
    })

    if (!shouldPreselect) {
      await test.step(`Go through the command bar flow without preselected faces`, async () => {
        await toolbar.shellButton.click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'selection',
          currentArgValue: '',
          headerArguments: {
            Selection: '',
            Thickness: '',
          },
          highlightedHeaderArg: 'selection',
          commandName: 'Shell',
        })
        await clickOnCap()
        await page.waitForTimeout(500)
        await cmdBar.progressCmdBar()
        await page.waitForTimeout(500)
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Selection: '1 cap',
            Thickness: '5',
          },
          commandName: 'Shell',
        })
        await cmdBar.progressCmdBar()
      })
    } else {
      await test.step(`Preselect the cap`, async () => {
        await clickOnCap()
        await page.waitForTimeout(500)
      })

      await test.step(`Go through the command bar flow with a preselected face (cap)`, async () => {
        await toolbar.shellButton.click()
        await cmdBar.progressCmdBar()
        await page.waitForTimeout(500)
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Selection: '1 cap',
            Thickness: '5',
          },
          commandName: 'Shell',
        })
        await cmdBar.progressCmdBar()
      })
    }

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await editor.expectEditor.toContain(shellDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [shellDeclaration],
        highlightedCode: '',
      })
      await scene.expectPixelColor([146, 146, 146], testPoint, 15)
    })
  })
})

test('Shell point-and-click wall', async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
  cmdBar,
}) => {
  const initialCode = `sketch001 = startSketchOn('XY')
  |> startProfileAt([-20, 20], %)
  |> xLine(40, %)
  |> yLine(-60, %)
  |> xLine(-40, %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 40)
  `
  await context.addInitScript((initialCode) => {
    localStorage.setItem('persistCode', initialCode)
  }, initialCode)
  await page.setBodyDimensions({ width: 1000, height: 500 })
  await homePage.goToModelingScene()
  await scene.waitForExecutionDone()

  // One dumb hardcoded screen pixel value
  const testPoint = { x: 580, y: 180 }
  const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
  const [clickOnWall] = scene.makeMouseHelpers(testPoint.x, testPoint.y + 70)
  const mutatedCode = 'xLine(-40, %, $seg01)'
  const shellDeclaration =
    "shell001 = shell({  faces = ['end', seg01],  thickness = 5}, extrude001)"
  const formattedOutLastLine = '}, extrude001)'

  await test.step(`Look for the grey of the shape`, async () => {
    await scene.expectPixelColor([99, 99, 99], testPoint, 15)
  })

  await test.step(`Go through the command bar flow, selecting a wall and keeping default thickness`, async () => {
    await toolbar.shellButton.click()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Thickness: '',
      },
      highlightedHeaderArg: 'selection',
      commandName: 'Shell',
    })
    await clickOnCap()
    await page.keyboard.down('Shift')
    await clickOnWall()
    await page.waitForTimeout(500)
    await page.keyboard.up('Shift')
    await cmdBar.progressCmdBar()
    await page.waitForTimeout(500)
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'review',
      headerArguments: {
        Selection: '1 cap, 1 face',
        Thickness: '5',
      },
      commandName: 'Shell',
    })
    await cmdBar.progressCmdBar()
  })

  await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
    await editor.expectEditor.toContain(mutatedCode)
    await editor.expectEditor.toContain(shellDeclaration)
    await editor.expectState({
      diagnostics: [],
      activeLines: [formattedOutLastLine],
      highlightedCode: '',
    })
    await scene.expectPixelColor([49, 49, 49], testPoint, 15)
  })

  await test.step('Delete shell via feature tree selection', async () => {
    await editor.closePane()
    const operationButton = await toolbar.getFeatureTreeOperation('Shell', 0)
    await operationButton.click({ button: 'left' })
    await page.keyboard.press('Backspace')
    await scene.expectPixelColor([99, 99, 99], testPoint, 15)
  })
})

const shellSketchOnFacesCases = [
  `sketch001 = startSketchOn('XZ')
  |> circle({ center = [0, 0], radius = 100 }, %)
  |> extrude(length = 100)

sketch002 = startSketchOn(sketch001, 'END')
  |> circle({ center = [0, 0], radius = 50 }, %)
  |> extrude(length = 50)
  `,
  `sketch001 = startSketchOn('XZ')
  |> circle({ center = [0, 0], radius = 100 }, %)
extrude001 = extrude(sketch001, length = 100)

sketch002 = startSketchOn(extrude001, 'END')
  |> circle({ center = [0, 0], radius = 50 }, %)
extrude002 = extrude(sketch002, length = 50)
  `,
]
shellSketchOnFacesCases.forEach((initialCode, index) => {
  const hasExtrudesInPipe = index === 0
  test(`Shell point-and-click sketch on face (extrudes in pipes: ${hasExtrudesInPipe})`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 550, y: 295 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const shellDeclaration = `shell001 = shell({ faces = ['end'], thickness = 5 }, ${
      hasExtrudesInPipe ? 'sketch002' : 'extrude002'
    })`

    await test.step(`Look for the grey of the shape`, async () => {
      await toolbar.closePane('code')
      await scene.expectPixelColor([128, 128, 128], testPoint, 15)
    })

    await test.step(`Go through the command bar flow, selecting a cap and keeping default thickness`, async () => {
      await toolbar.shellButton.click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'selection',
        currentArgValue: '',
        headerArguments: {
          Selection: '',
          Thickness: '',
        },
        highlightedHeaderArg: 'selection',
        commandName: 'Shell',
      })
      await clickOnCap()
      await page.waitForTimeout(500)
      await cmdBar.progressCmdBar()
      await page.waitForTimeout(500)
      await cmdBar.progressCmdBar()
      await page.waitForTimeout(500)
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Selection: '1 cap',
          Thickness: '5',
        },
        commandName: 'Shell',
      })
      await cmdBar.progressCmdBar()
    })

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await toolbar.openPane('code')
      await editor.expectEditor.toContain(shellDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [shellDeclaration],
        highlightedCode: '',
      })
      await toolbar.closePane('code')
      await scene.expectPixelColor([73, 73, 73], testPoint, 15)
    })
  })
})

test(`Shell dry-run validation rejects sweeps`, async ({
  context,
  page,
  homePage,
  scene,
  editor,
  toolbar,
  cmdBar,
}) => {
  const initialCode = `sketch001 = startSketchOn('YZ')
  |> circle({
       center = [0, 0],
       radius = 500
     }, %)
sketch002 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> xLine(-2000, %)
sweep001 = sweep({ path = sketch002 }, sketch001)
`
  await context.addInitScript((initialCode) => {
    localStorage.setItem('persistCode', initialCode)
  }, initialCode)
  await page.setBodyDimensions({ width: 1000, height: 500 })
  await homePage.goToModelingScene()
  await scene.waitForExecutionDone()

  // One dumb hardcoded screen pixel value
  const testPoint = { x: 500, y: 250 }
  const [clickOnSweep] = scene.makeMouseHelpers(testPoint.x, testPoint.y)

  await test.step(`Confirm sweep exists`, async () => {
    await toolbar.closePane('code')
    await scene.expectPixelColor([231, 231, 231], testPoint, 15)
  })

  await test.step(`Go through the Shell flow and fail validation with a toast`, async () => {
    await toolbar.shellButton.click()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'selection',
      currentArgValue: '',
      headerArguments: {
        Selection: '',
        Thickness: '',
      },
      highlightedHeaderArg: 'selection',
      commandName: 'Shell',
    })
    await clickOnSweep()
    await page.waitForTimeout(500)
    await cmdBar.progressCmdBar()
    await expect(
      page.getByText('Unable to shell with the current selection. Reason:')
    ).toBeVisible()
    await page.waitForTimeout(1000)
  })
})

test.describe('Revolve point and click workflows', () => {
  test('Base case workflow, auto spam continue in command bar', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `
sketch001 = startSketchOn('XZ')
|> startProfileAt([-100.0, 100.0], %)
|> angledLine([0, 200.0], %, $rectangleSegmentA001)
|> angledLine([segAng(rectangleSegmentA001) - 90, 200], %, $rectangleSegmentB001)
|> angledLine([
segAng(rectangleSegmentA001),
-segLen(rectangleSegmentA001)
], %, $rectangleSegmentC001)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
extrude001 = extrude(sketch001, length = 200)
sketch002 = startSketchOn(extrude001, rectangleSegmentA001)
|> startProfileAt([-66.77, 84.81], %)
|> angledLine([180, 27.08], %, $rectangleSegmentA002)
|> angledLine([
segAng(rectangleSegmentA002) - 90,
27.8
], %, $rectangleSegmentB002)
|> angledLine([
segAng(rectangleSegmentA002),
-segLen(rectangleSegmentA002)
], %, $rectangleSegmentC002)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    // select line of code
    const codeToSelecton = `segAng(rectangleSegmentA002) - 90,`
    // revolve
    await page.getByText(codeToSelecton).click()
    await toolbar.revolveButton.click()
    await cmdBar.progressCmdBar()
    await cmdBar.progressCmdBar()
    await cmdBar.progressCmdBar()
    await cmdBar.progressCmdBar()

    const newCodeToFind = `revolve001 = revolve({ angle = 360, axis = 'X' }, sketch002)`
    expect(editor.expectEditor.toContain(newCodeToFind)).toBeTruthy()
  })
  test('revolve surface around edge from an extruded solid2d', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `
sketch001 = startSketchOn('XZ')
|> startProfileAt([-102.57, 101.72], %)
|> angledLine([0, 202.6], %, $rectangleSegmentA001)
|> angledLine([
segAng(rectangleSegmentA001) - 90,
202.6
], %, $rectangleSegmentB001)
|> angledLine([
segAng(rectangleSegmentA001),
-segLen(rectangleSegmentA001)
], %, $rectangleSegmentC001)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
extrude001 = extrude(sketch001, length = 50)
sketch002 = startSketchOn(extrude001, rectangleSegmentA001)
|> circle({
center = [-11.34, 10.0],
radius = 8.69
}, %)
`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    // select line of code
    const codeToSelecton = `center = [-11.34, 10.0]`
    // revolve
    await page.getByText(codeToSelecton).click()
    await toolbar.revolveButton.click()
    await page.getByText('Edge', { exact: true }).click()
    const lineCodeToSelection = `|> angledLine([0, 202.6], %, $rectangleSegmentA001)`
    await page.getByText(lineCodeToSelection).click()
    await cmdBar.progressCmdBar()

    const newCodeToFind = `revolve001 = revolve({angle = 360, axis = getOppositeEdge(rectangleSegmentA001)}, sketch002) `
    expect(editor.expectEditor.toContain(newCodeToFind)).toBeTruthy()
  })
  test('revolve sketch circle around line segment from startProfileAt sketch', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `
    sketch002 = startSketchOn('XY')
      |> startProfileAt([-2.02, 1.79], %)
      |> xLine(2.6, %)
    sketch001 = startSketchOn('-XY')
      |> startProfileAt([-0.48, 1.25], %)
      |> angledLine([0, 2.38], %, $rectangleSegmentA001)
      |> angledLine([segAng(rectangleSegmentA001) - 90, 2.4], %, $rectangleSegmentB001)
      |> angledLine([
        segAng(rectangleSegmentA001),
          -segLen(rectangleSegmentA001)
      ], %, $rectangleSegmentC001)
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    extrude001 = extrude(sketch001, length = 5)
    sketch003 = startSketchOn(extrude001, 'START')
      |> circle({
        center = [-0.69, 0.56],
        radius = 0.28
      }, %)
`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    // select line of code
    const codeToSelecton = `center = [-0.69, 0.56]`
    // revolve
    await page.getByText(codeToSelecton).click()
    await toolbar.revolveButton.click()
    await page.getByText('Edge', { exact: true }).click()
    const lineCodeToSelection = `|> xLine(2.6, %)`
    await page.getByText(lineCodeToSelection).click()
    await cmdBar.progressCmdBar()

    const newCodeToFind = `revolve001 = revolve({ angle = 360, axis = seg01 }, sketch003)`
    expect(editor.expectEditor.toContain(newCodeToFind)).toBeTruthy()
  })
})
