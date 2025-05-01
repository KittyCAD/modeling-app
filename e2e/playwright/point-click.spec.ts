import fs from 'node:fs/promises'
import path from 'node:path'
import type { Locator, Page } from '@playwright/test'

import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { expect, test } from '@e2e/playwright/zoo-test'

// test file is for testing point an click code gen functionality that's not sketch mode related

test.describe('Point-and-click tests', () => {
  test('verify extruding circle works', async ({
    page,
    context,
    homePage,
    cmdBar,
    editor,
    toolbar,
    scene,
  }) => {
    const file = await fs.readFile(
      path.resolve(
        __dirname,
        '../../',
        './rust/kcl-lib/e2e/executor/inputs/test-circle-extrude.kcl'
      ),
      'utf-8'
    )
    await context.addInitScript((file) => {
      localStorage.setItem('persistCode', file)
    }, file)

    await homePage.goToModelingScene()
    await scene.connectionEstablished()

    const [clickCircle, moveToCircle] = scene.makeMouseHelpers(582, 217)

    await test.step('because there is sweepable geometry, verify extrude is enable when nothing is selected', async () => {
      // FIXME: Do not click, clicking removes the activeLines in future checks
      // await scene.clickNoWhere()
      await expect(toolbar.extrudeButton).toBeEnabled()
    })

    await test.step('check code model connection works and that button is still enable once circle is selected ', async () => {
      await moveToCircle()
      const circleSnippet = 'circle(center = [318.33, 168.1], radius = 182.8)'
      await editor.expectState({
        activeLines: ['sketch002=startSketchOn(XZ)'],
        highlightedCode: circleSnippet,
        diagnostics: [],
      })

      await test.step('check code model connection works and that button is still enable once circle is selected ', async () => {
        await moveToCircle()
        const circleSnippet = 'circle(center = [318.33, 168.1], radius = 182.8)'
        await editor.expectState({
          activeLines: ['sketch002=startSketchOn(XZ)'],
          highlightedCode: circleSnippet,
          diagnostics: [],
        })

        await clickCircle()
        await editor.expectState({
          activeLines: ['|>' + circleSnippet],
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

        await test.step('check chamfer selection changes cursor position', async () => {
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
          await toolbar.exitSketch()
        })
        await test.step('Check there is no errors after code created in previous steps executes', async () => {
          await editor.expectState({
            activeLines: ['@settings(defaultLengthUnit = in)'],
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
      cmdBar,
    }) => {
      const file = await fs.readFile(
        path.resolve(
          __dirname,
          '../../',
          './rust/kcl-lib/e2e/executor/inputs/e2e-can-sketch-on-chamfer.kcl'
        ),
        'utf-8'
      )
      await context.addInitScript((file) => {
        localStorage.setItem('persistCode', file)
      }, file)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      const sketchOnAChamfer = _sketchOnAChamfer(page, editor, toolbar, scene)

      await sketchOnAChamfer({
        clickCoords: { x: 570, y: 220 },
        cameraPos: { x: 16020, y: -2000, z: 10500 },
        cameraTarget: { x: -150, y: -4500, z: -80 },
        beforeChamferSnippet: `angledLine(angle=segAng(rectangleSegmentA001)-90,length=217.26,tag=$seg01)
      chamfer(length = 30,tags = [
      seg01,
      getNextAdjacentEdge(yo),
      getNextAdjacentEdge(seg02),
      getOppositeEdge(seg01)
    ],
    )`,

        afterChamferSelectSnippet:
          'sketch002 = startSketchOn(extrude001, face = seg03)',
        afterRectangle1stClickSnippet:
          'startProfile(sketch002, at = [205.96, 254.59])',
        afterRectangle2ndClickSnippet: `angledLine(angle=0,length=11.39,tag=$rectangleSegmentA002)
        |>angledLine(angle=segAng(rectangleSegmentA002)-90,length=105.26)
        |>angledLine(angle=segAng(rectangleSegmentA002),length=-segLen(rectangleSegmentA002))
        |>line(endAbsolute=[profileStartX(%),profileStartY(%)])
        |>close()`,
      })

      await sketchOnAChamfer({
        clickCoords: { x: 690, y: 250 },
        cameraPos: { x: 16020, y: -2000, z: 10500 },
        cameraTarget: { x: -150, y: -4500, z: -80 },
        beforeChamferSnippet: `angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 217.26, tag = $seg01)chamfer(
         length = 30,
         tags = [
           seg01,
           getNextAdjacentEdge(yo),
           getNextAdjacentEdge(seg02)
         ]
       )`,

        afterChamferSelectSnippet:
          'sketch003 = startSketchOn(extrude001, face = seg04)',
        afterRectangle1stClickSnippet:
          'startProfile(sketch003, at = [-209.64, 255.28])',
        afterRectangle2ndClickSnippet: `angledLine(angle=0,length=11.56,tag=$rectangleSegmentA003)
        |>angledLine(angle=segAng(rectangleSegmentA003)-90,length=106.84)
        |>angledLine(angle=segAng(rectangleSegmentA003),length=-segLen(rectangleSegmentA003))
        |>line(endAbsolute=[profileStartX(%),profileStartY(%)])
        |>close()`,
      })

      await sketchOnAChamfer({
        clickCoords: { x: 677, y: 87 },
        cameraPos: { x: -6200, y: 1500, z: 6200 },
        cameraTarget: { x: 8300, y: 1100, z: 4800 },
        beforeChamferSnippet: `angledLine(angle = 0, length = 268.43, tag = $rectangleSegmentA001)chamfer(
         length = 30,
         tags = [
           getNextAdjacentEdge(yo),
           getNextAdjacentEdge(seg02)
         ]
       )`,
        afterChamferSelectSnippet:
          'sketch004 = startSketchOn(extrude001, face = seg05)',
        afterRectangle1stClickSnippet:
          'startProfile(sketch004, at = [82.57, 322.96])',
        afterRectangle2ndClickSnippet: `angledLine(angle=0,length=11.16,tag=$rectangleSegmentA004)
        |>angledLine(angle=segAng(rectangleSegmentA004)-90,length=103.07)
        |>angledLine(angle=segAng(rectangleSegmentA004),length=-segLen(rectangleSegmentA004))
        |>line(endAbsolute=[profileStartX(%),profileStartY(%)])
        |>close()`,
      })
      /// last one
      await sketchOnAChamfer({
        clickCoords: { x: 620, y: 300 },
        cameraPos: { x: -1100, y: -7700, z: 1600 },
        cameraTarget: { x: 1450, y: 670, z: 4000 },
        beforeChamferSnippet: `chamfer(length = 30, tags = [getNextAdjacentEdge(yo)])`,
        beforeChamferSnippetEnd:
          '|> chamfer(length = 30, tags = [getNextAdjacentEdge(yo)])',
        afterChamferSelectSnippet:
          'sketch005 = startSketchOn(extrude001, face = seg06)',
        afterRectangle1stClickSnippet:
          'startProfile(sketch005, at = [-23.43, 19.69])',
        afterRectangle2ndClickSnippet: `angledLine(angle=0,length=9.1,tag=$rectangleSegmentA005)
        |>angledLine(angle=segAng(rectangleSegmentA005)-90,length=84.07)
        |>angledLine(angle=segAng(rectangleSegmentA005),length=-segLen(rectangleSegmentA005))
        |>line(endAbsolute=[profileStartX(%),profileStartY(%)])
        |>close()`,
      })

      await test.step('verify at the end of the test that final code is what is expected', async () => {
        await editor.expectEditor.toContain(
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [75.8, 317.2]) // [$startCapTag, $EndCapTag]
  |> angledLine(angle = 0, length = 268.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 217.26, tag = $seg01)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $yo)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(sketch001, length = 100)
  |> chamfer(length = 30, tags = [getOppositeEdge(seg01)], tag = $seg03)
  |> chamfer(length = 30, tags = [seg01], tag = $seg04)
  |> chamfer(length = 30, tags = [getNextAdjacentEdge(seg02)], tag = $seg05)
  |> chamfer(length = 30, tags = [getNextAdjacentEdge(yo)], tag = $seg06)
sketch005 = startSketchOn(extrude001, face = seg06)
profile004=startProfile(sketch005, at = [-23.43,19.69])
  |> angledLine(angle = 0, length = 9.1, tag = $rectangleSegmentA005)
  |> angledLine(angle = segAng(rectangleSegmentA005) - 90, length = 84.07)
  |> angledLine(angle = segAng(rectangleSegmentA005), length = -segLen(rectangleSegmentA005))
  |> line(endAbsolute=[profileStartX(%), profileStartY(%)])
  |> close()
sketch004 = startSketchOn(extrude001, face = seg05)
profile003 = startProfile(sketch004, at = [82.57, 322.96])
  |> angledLine(angle = 0, length = 11.16, tag = $rectangleSegmentA004)
  |> angledLine(angle = segAng(rectangleSegmentA004) - 90, length = 103.07)
  |> angledLine(angle = segAng(rectangleSegmentA004), length = -segLen(rectangleSegmentA004))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(extrude001, face = seg04)
profile002 = startProfile(sketch003, at = [-209.64, 255.28])
  |> angledLine(angle = 0, length = 11.56, tag = $rectangleSegmentA003)
  |> angledLine(angle = segAng(rectangleSegmentA003) - 90, length = 106.84)
  |> angledLine(angle = segAng(rectangleSegmentA003), length = -segLen(rectangleSegmentA003))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(extrude001, face = seg03)
profile001 = startProfile(sketch002, at = [205.96, 254.59])
  |> angledLine(angle = 0, length = 11.39, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) - 90, length = 105.26)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`,
          { shouldNormalise: true }
        )
      })
    })

    test('Works on chamfers that are not in a pipeExpression can break up multi edges in a chamfer array', async ({
      context,
      page,
      homePage,
      editor,
      toolbar,
      scene,
      cmdBar,
    }) => {
      const file = await fs.readFile(
        path.resolve(
          __dirname,
          '../../',
          './rust/kcl-lib/e2e/executor/inputs/e2e-can-sketch-on-chamfer-no-pipeExpr.kcl'
        ),
        'utf-8'
      )
      await context.addInitScript((file) => {
        localStorage.setItem('persistCode', file)
      }, file)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()

      await scene.settled(cmdBar)

      const sketchOnAChamfer = _sketchOnAChamfer(page, editor, toolbar, scene)

      await sketchOnAChamfer({
        clickCoords: { x: 570, y: 220 },
        cameraPos: { x: 16020, y: -2000, z: 10500 },
        cameraTarget: { x: -150, y: -4500, z: -80 },
        beforeChamferSnippet: `angledLine(angle=segAng(rectangleSegmentA001)-90,length=217.26,tag=$seg01)
      chamfer(extrude001,length=30,tags=[
      seg01,
      getNextAdjacentEdge(yo),
      getNextAdjacentEdge(seg02),
      getOppositeEdge(seg01),
    ])`,
        beforeChamferSnippetEnd: ')',
        afterChamferSelectSnippet:
          'sketch002 = startSketchOn(extrude001, face = seg03)',
        afterRectangle1stClickSnippet:
          'startProfile(sketch002, at = [205.96, 254.59])',
        afterRectangle2ndClickSnippet: `angledLine(angle=0,length=11.39,tag=$rectangleSegmentA002)
        |>angledLine(angle=segAng(rectangleSegmentA002)-90,length=105.26)
        |>angledLine(angle=segAng(rectangleSegmentA002),length=-segLen(rectangleSegmentA002))
        |>line(endAbsolute=[profileStartX(%),profileStartY(%)])
        |>close()`,
      })
      await editor.expectEditor.toContain(
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [75.8, 317.2])
  |> angledLine(angle = 0, length = 268.43, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 217.26, tag = $seg01)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $yo)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
  |> close()
extrude001 = extrude(sketch001, length = 100)
chamf = chamfer(
       extrude001,
       length = 30,
       tags = [getOppositeEdge(seg01)],
       tag = $seg03,
     )
  |> chamfer(
       length = 30,
       tags = [
         seg01,
         getNextAdjacentEdge(yo),
         getNextAdjacentEdge(seg02)
       ],
     )
sketch002 = startSketchOn(extrude001, face = seg03)
profile001 = startProfile(sketch002, at = [205.96, 254.59])
  |> angledLine(angle = 0, length = 11.39, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) - 90, length = 105.26)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
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
    await scene.connectionEstablished()

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
      sketchOnXzPlane: `sketch001 = startSketchOn(XZ)`,
      pointAtOrigin: `startProfile(sketch001, at = [${originSloppy.kcl[0]}, ${originSloppy.kcl[1]}])`,
      segmentOnXAxis: `xLine(length = ${xAxisSloppy.kcl[0]})`,
      afterSegmentDraggedOffYAxis: `startProfile(sketch001, at = [${offYAxis.kcl[0]}, ${offYAxis.kcl[1]}])`,
      afterSegmentDraggedOnYAxis: `startProfile(sketch001, at = [${yAxisSloppy.kcl[0]}, ${yAxisSloppy.kcl[1]}])`,
    }

    await test.step(`Start a sketch on the XZ plane`, async () => {
      await editor.closePane()
      await toolbar.startSketchPlaneSelection()
      await moveToXzPlane()
      await clickOnXzPlane()
      await toolbar.waitUntilSketchingReady()
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
    await editor.page.waitForTimeout(1000)
  })

  test(`Verify user can double-click to edit a sketch`, async ({
    context,
    page,
    homePage,
    editor,
    toolbar,
    scene,
    cmdBar,
  }) => {
    const initialCode = `closedSketch = startSketchOn(XZ)
  |> circle(center = [8, 5], radius = 2)
openSketch = startSketchOn(XY)
  |> startProfile(at = [-5, 0])
  |> line(endAbsolute = [0, 5])
  |> xLine(length = 5)
  |> tangentialArc(endAbsolute = [10, 0])
`
    const viewPortSize = { width: 1000, height: 500 }
    await page.setBodyDimensions(viewPortSize)

    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, initialCode)

    await homePage.goToModelingScene()

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
        await expect(toolbar.startSketchBtn).toBeEnabled()
      })
    }

    await test.step(`Double-click on the closed sketch`, async () => {
      await scene.settled(cmdBar)
      await moveToCircle()
      await page.waitForTimeout(1000)
      await dblClickCircle()
      await page.waitForTimeout(1000)
      await expect(toolbar.exitSketchBtn).toBeVisible()
      await editor.expectState({
        activeLines: [`|>circle(center=[8,5],radius=2)`],
        highlightedCode: 'circle(center=[8,5],radius=2)',
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
      await scene.expectPixelColor(
        [250, 250, 250],
        pointOnPathAfterSketching,
        15
      )
      // There is a full execution after exiting sketch that clears the scene.
      await page.waitForTimeout(500)
      await dblClickOpenPath()
      await expect(toolbar.exitSketchBtn).toBeVisible()
      // Wait for enter sketch mode to complete
      await page.waitForTimeout(500)
      await editor.expectState({
        activeLines: [`|>tangentialArc(endAbsolute=[10,0])`],
        highlightedCode: 'tangentialArc(endAbsolute=[10,0])',
        diagnostics: [],
      })
    })
  })

  test(`Shift-click to select and deselect edges and faces`, async ({
    context,
    page,
    homePage,
    scene,
  }) => {
    // Code samples
    const initialCode = `sketch001 = startSketchOn(XY)
    |> startProfile(at = [-12, -6])
    |> line(end = [0, 12])
    |> line(end = [24, 0])
    |> line(end = [0, -12])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
    |> extrude(%, length = -12)`

    // Locators
    const upperEdgeLocation = { x: 600, y: 192 }
    const lowerEdgeLocation = { x: 600, y: 383 }
    const faceLocation = { x: 630, y: 290 }

    // Click helpers
    const [clickOnUpperEdge] = scene.makeMouseHelpers(
      upperEdgeLocation.x,
      upperEdgeLocation.y
    )
    const [clickOnLowerEdge] = scene.makeMouseHelpers(
      lowerEdgeLocation.x,
      lowerEdgeLocation.y
    )
    const [clickOnFace] = scene.makeMouseHelpers(faceLocation.x, faceLocation.y)

    // Colors
    const edgeColorWhite: [number, number, number] = [220, 220, 220] // varies from 192 to 255
    const edgeColorYellow: [number, number, number] = [251, 251, 40] // vaies from 12 to 67
    const faceColorGray: [number, number, number] = [168, 168, 168]
    const faceColorYellow: [number, number, number] = [155, 155, 155]
    const tolerance = 40
    const timeout = 150

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()

      // Wait for the scene and stream to load
      await scene.expectPixelColor(faceColorGray, faceLocation, tolerance)
    })

    await test.step('Select and deselect a single edge', async () => {
      await test.step('Click the edge', async () => {
        await scene.expectPixelColor(
          edgeColorWhite,
          upperEdgeLocation,
          tolerance
        )
        await clickOnUpperEdge()
        await scene.expectPixelColor(
          edgeColorYellow,
          upperEdgeLocation,
          tolerance
        )
      })
      await test.step('Shift-click the same edge to deselect', async () => {
        await page.keyboard.down('Shift')
        await page.waitForTimeout(timeout)
        await clickOnUpperEdge()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await scene.expectPixelColor(
          edgeColorWhite,
          upperEdgeLocation,
          tolerance
        )
      })
    })

    await test.step('Select and deselect multiple objects', async () => {
      await test.step('Select both edges and the face', async () => {
        await test.step('Select the upper edge', async () => {
          await scene.expectPixelColor(
            edgeColorWhite,
            upperEdgeLocation,
            tolerance
          )
          await clickOnUpperEdge()
          await scene.expectPixelColor(
            edgeColorYellow,
            upperEdgeLocation,
            tolerance
          )
        })
        await test.step('Select the lower edge (Shift-click)', async () => {
          await scene.expectPixelColor(
            edgeColorWhite,
            lowerEdgeLocation,
            tolerance
          )
          await page.keyboard.down('Shift')
          await page.waitForTimeout(timeout)
          await clickOnLowerEdge()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await scene.expectPixelColor(
            edgeColorYellow,
            lowerEdgeLocation,
            tolerance
          )
        })
        await test.step('Select the face (Shift-click)', async () => {
          await scene.expectPixelColor(faceColorGray, faceLocation, tolerance)
          await page.keyboard.down('Shift')
          await page.waitForTimeout(timeout)
          await clickOnFace()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await scene.expectPixelColor(faceColorYellow, faceLocation, tolerance)
        })
      })
      await test.step('Deselect them one by one', async () => {
        await test.step('Deselect the face (Shift-click)', async () => {
          await scene.expectPixelColor(faceColorYellow, faceLocation, tolerance)
          await page.keyboard.down('Shift')
          await page.waitForTimeout(timeout)
          await clickOnFace()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await scene.expectPixelColor(faceColorGray, faceLocation, tolerance)
        })
        await test.step('Deselect the lower edge (Shift-click)', async () => {
          await scene.expectPixelColor(
            edgeColorYellow,
            lowerEdgeLocation,
            tolerance
          )
          await page.keyboard.down('Shift')
          await page.waitForTimeout(timeout)
          await clickOnLowerEdge()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await scene.expectPixelColor(
            edgeColorWhite,
            lowerEdgeLocation,
            tolerance
          )
        })
        await test.step('Deselect the upper edge (Shift-click)', async () => {
          await scene.expectPixelColor(
            edgeColorYellow,
            upperEdgeLocation,
            tolerance
          )
          await page.keyboard.down('Shift')
          await page.waitForTimeout(timeout)
          await clickOnUpperEdge()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await scene.expectPixelColor(
            edgeColorWhite,
            upperEdgeLocation,
            tolerance
          )
        })
      })
    })
  })

  test(`Shift-click to select and deselect sketch segments`, async ({
    page,
    homePage,
    scene,
    editor,
  }) => {
    // Locators
    const firstPointLocation = { x: 200, y: 100 }
    const secondPointLocation = { x: 800, y: 100 }
    const thirdPointLocation = { x: 800, y: 400 }
    const fristSegmentLocation = { x: 750, y: 100 }
    const secondSegmentLocation = { x: 800, y: 150 }
    const planeLocation = { x: 700, y: 200 }

    // Click helpers
    const [clickFirstPoint] = scene.makeMouseHelpers(
      firstPointLocation.x,
      firstPointLocation.y
    )
    const [clickSecondPoint] = scene.makeMouseHelpers(
      secondPointLocation.x,
      secondPointLocation.y
    )
    const [clickThirdPoint] = scene.makeMouseHelpers(
      thirdPointLocation.x,
      thirdPointLocation.y
    )
    const [clickFirstSegment] = scene.makeMouseHelpers(
      fristSegmentLocation.x,
      fristSegmentLocation.y
    )
    const [clickSecondSegment] = scene.makeMouseHelpers(
      secondSegmentLocation.x,
      secondSegmentLocation.y
    )
    const [clickPlane] = scene.makeMouseHelpers(
      planeLocation.x,
      planeLocation.y
    )

    // Colors
    const edgeColorWhite: [number, number, number] = [220, 220, 220]
    const edgeColorBlue: [number, number, number] = [20, 20, 200]
    const backgroundColor: [number, number, number] = [30, 30, 30]
    const tolerance = 40
    const timeout = 150

    // Setup
    await test.step(`Initial test setup`, async () => {
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()

      // Wait for the scene and stream to load
      await scene.expectPixelColor(
        backgroundColor,
        secondPointLocation,
        tolerance
      )
    })

    await test.step('Select and deselect a single sketch segment', async () => {
      await test.step('Get into sketch mode', async () => {
        await editor.closePane()
        await page.waitForTimeout(timeout)
        await page.getByRole('button', { name: 'Start Sketch' }).click()
        await page.waitForTimeout(timeout)
        await clickPlane()
        await page.waitForTimeout(1000)
      })
      await test.step('Draw sketch', async () => {
        await clickFirstPoint()
        await page.waitForTimeout(timeout)
        await clickSecondPoint()
        await page.waitForTimeout(timeout)
        await clickThirdPoint()
        await page.waitForTimeout(timeout)
      })
      await test.step('Deselect line tool', async () => {
        const btnLine = page.getByTestId('line')
        const btnLineAriaPressed = await btnLine.getAttribute('aria-pressed')
        if (btnLineAriaPressed === 'true') {
          await btnLine.click()
        }
        await page.waitForTimeout(timeout)
      })
      await test.step('Select the first segment', async () => {
        await page.waitForTimeout(timeout)
        await clickFirstSegment()
        await page.waitForTimeout(timeout)
        await scene.expectPixelColor(
          edgeColorBlue,
          fristSegmentLocation,
          tolerance
        )
        await scene.expectPixelColor(
          edgeColorWhite,
          secondSegmentLocation,
          tolerance
        )
      })
      await test.step('Select the second segment (Shift-click)', async () => {
        await page.keyboard.down('Shift')
        await page.waitForTimeout(timeout)
        await clickSecondSegment()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await scene.expectPixelColor(
          edgeColorBlue,
          fristSegmentLocation,
          tolerance
        )
        await scene.expectPixelColor(
          edgeColorBlue,
          secondSegmentLocation,
          tolerance
        )
      })
      await test.step('Deselect the first segment', async () => {
        await page.keyboard.down('Shift')
        await page.waitForTimeout(timeout)
        await clickFirstSegment()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await scene.expectPixelColor(
          edgeColorWhite,
          fristSegmentLocation,
          tolerance
        )
        await scene.expectPixelColor(
          edgeColorBlue,
          secondSegmentLocation,
          tolerance
        )
      })
      await test.step('Deselect the second segment', async () => {
        await page.keyboard.down('Shift')
        await page.waitForTimeout(timeout)
        await clickSecondSegment()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await scene.expectPixelColor(
          edgeColorWhite,
          fristSegmentLocation,
          tolerance
        )
        await scene.expectPixelColor(
          edgeColorWhite,
          secondSegmentLocation,
          tolerance
        )
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
    const expectedOutput = `plane001 = offsetPlane(XZ, offset = 5)`

    await homePage.goToModelingScene()
    // FIXME: Since there is no KCL code loaded. We need to wait for the scene to load before we continue.
    // The engine may not be connected
    await page.waitForTimeout(15000)

    await test.step(`Look for the blue of the XZ plane`, async () => {
      //await scene.expectPixelColor([50, 51, 96], testPoint, 15) // FIXME
    })
    await test.step(`Go through the command bar flow`, async () => {
      await toolbar.offsetPlaneButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
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
      await page.keyboard.press('Delete')
      //await scene.expectPixelColor([50, 51, 96], testPoint, 15) // FIXME
    })
  })

  test('Helix point-and-click on default axis', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    // One dumb hardcoded screen pixel value
    const testPoint = { x: 620, y: 257 }
    const expectedOutput = `helix001 = helix(  axis = X,  radius = 5,  length = 5,  revolutions = 1,  angleStart = 270,  ccw = false,)`
    const expectedLine = `axis=X,`

    await homePage.goToModelingScene()
    await scene.connectionEstablished()

    await test.step(`Go through the command bar flow`, async () => {
      await toolbar.helixButton.click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'mode',
        currentArgValue: '',
        headerArguments: {
          Mode: '',
          AngleStart: '',
          Revolutions: '',
          Radius: '',
          CounterClockWise: '',
        },
        highlightedHeaderArg: 'mode',
        commandName: 'Helix',
      })
      await cmdBar.progressCmdBar()
      await expect.poll(() => page.getByText('Axis').count()).toBe(6)
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'angleStart',
        highlightedHeaderArg: 'angleStart',
        currentArgValue: '360',
        headerArguments: {
          Mode: 'Axis',
          Axis: 'X',
          Revolutions: '1',
          AngleStart: '',
          Length: '',
          Radius: '',
          CounterClockWise: '',
        },
        commandName: 'Helix',
      })
      await cmdBar.currentArgumentInput.locator('.cm-content').fill('270')
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Mode: 'Axis',
          Axis: 'X',
          AngleStart: '270',
          Revolutions: '1',
          Length: '5',
          Radius: '5',
          CounterClockWise: '',
        },
        commandName: 'Helix',
      })
      await cmdBar.progressCmdBar()
    })

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await editor.expectEditor.toContain(expectedOutput)
      await editor.expectState({
        diagnostics: [],
        activeLines: [expectedLine],
        highlightedCode: '',
      })
      // Red plane is now gone, white helix is there
      await scene.expectPixelColor([250, 250, 250], testPoint, 15)
    })

    await test.step(`Edit helix through the feature tree`, async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.dblclick()
      const initialInput = '5'
      const newInput = '50'
      await cmdBar.expectState({
        commandName: 'Helix',
        stage: 'arguments',
        currentArgKey: 'CounterClockWise',
        currentArgValue: '',
        headerArguments: {
          Axis: 'X',
          AngleStart: '270',
          Revolutions: '1',
          Radius: '5',
          Length: initialInput,
          CounterClockWise: '',
        },
        highlightedHeaderArg: 'CounterClockWise',
      })
      await page.keyboard.press('Shift+Backspace')
      await expect(cmdBar.currentArgumentInput).toBeVisible()
      await cmdBar.currentArgumentInput.locator('.cm-content').fill(newInput)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Axis: 'X',
          AngleStart: '270',
          Revolutions: '1',
          Radius: '5',
          Length: newInput,
          CounterClockWise: '',
        },
        commandName: 'Helix',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closeFeatureTreePane()
      await editor.openPane()
      await editor.expectEditor.toContain('length = ' + newInput)
    })

    await test.step('Delete helix via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      // Red plane is back
      await scene.expectPixelColor([96, 52, 52], testPoint, 15)
    })
  })

  const helixCases = [
    {
      selectionType: 'segment',
      testPoint: { x: 513, y: 221 },
      expectedOutput: `helix001 = helix(  axis = seg01,  radius = 1,  revolutions = 20,  angleStart = 0,  ccw = false,)`,
      expectedEditedOutput: `helix001 = helix(  axis = seg01,  radius = 5,  revolutions = 20,  angleStart = 0,  ccw = false,)`,
    },
    {
      selectionType: 'sweepEdge',
      testPoint: { x: 564, y: 364 },
      expectedOutput: `helix001 = helix(  axis =   getOppositeEdge(seg01),  radius = 1,  revolutions = 20,  angleStart = 0,  ccw = false,)`,
      expectedEditedOutput: `helix001 = helix(  axis =   getOppositeEdge(seg01),  radius = 5,  revolutions = 20,  angleStart = 0,  ccw = false,)`,
    },
  ]
  helixCases.map(
    ({ selectionType, testPoint, expectedOutput, expectedEditedOutput }) => {
      test(`Helix point-and-click around ${selectionType}`, async ({
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
      }) => {
        page.on('console', console.log)
        const initialCode = `sketch001 = startSketchOn(XZ)
  profile001 = startProfile(sketch001, at = [0, 0])
    |> yLine(length = 100)
    |> line(endAbsolute = [100, 0])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(profile001, length = 100)`

        // One dumb hardcoded screen pixel value
        const [clickOnEdge] = scene.makeMouseHelpers(testPoint.x, testPoint.y)

        await context.addInitScript((initialCode) => {
          localStorage.setItem('persistCode', initialCode)
        }, initialCode)
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await test.step(`Go through the command bar flow`, async () => {
          await toolbar.closePane('code')
          await toolbar.helixButton.click()
          await cmdBar.expectState({
            stage: 'arguments',
            currentArgKey: 'mode',
            currentArgValue: '',
            headerArguments: {
              AngleStart: '',
              Mode: '',
              CounterClockWise: '',
              Radius: '',
              Revolutions: '',
            },
            highlightedHeaderArg: 'mode',
            commandName: 'Helix',
          })
          await cmdBar.selectOption({ name: 'Edge' }).click()
          await expect
            .poll(() => page.getByText('Please select one').count())
            .toBe(1)
          await clickOnEdge()
          await page.waitForTimeout(1000)
          await cmdBar.progressCmdBar()
          await page.waitForTimeout(1000)
          await cmdBar.argumentInput.focus()
          await page.waitForTimeout(1000)
          await page.keyboard.insertText('20')
          await cmdBar.progressCmdBar()
          await page.keyboard.insertText('0')
          await cmdBar.progressCmdBar()
          await page.keyboard.insertText('1')
          await cmdBar.progressCmdBar()
          await page.keyboard.insertText('100')
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Mode: 'Edge',
              Edge: `1 ${selectionType}`,
              AngleStart: '0',
              Revolutions: '20',
              Radius: '1',
              CounterClockWise: '',
            },
            commandName: 'Helix',
          })
          await cmdBar.progressCmdBar()
          await page.waitForTimeout(1000)
        })

        await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
          await toolbar.openPane('code')
          await editor.expectEditor.toContain(expectedOutput)
          await toolbar.closePane('code')
        })

        await test.step(`Edit helix through the feature tree`, async () => {
          await toolbar.openPane('feature-tree')
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Helix',
            0
          )
          await operationButton.dblclick()
          const initialInput = '1'
          const newInput = '5'
          await cmdBar.expectState({
            commandName: 'Helix',
            stage: 'arguments',
            currentArgKey: 'CounterClockWise',
            currentArgValue: '',
            headerArguments: {
              AngleStart: '0',
              Revolutions: '20',
              Radius: initialInput,
              CounterClockWise: '',
            },
            highlightedHeaderArg: 'CounterClockWise',
          })
          await page
            .getByRole('button', { name: 'radius', exact: false })
            .click()
          await expect(cmdBar.currentArgumentInput).toBeVisible()
          await cmdBar.currentArgumentInput
            .locator('.cm-content')
            .fill(newInput)
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              AngleStart: '0',
              Revolutions: '20',
              Radius: newInput,
              CounterClockWise: '',
            },
            commandName: 'Helix',
          })
          await cmdBar.progressCmdBar()
          await toolbar.closePane('feature-tree')
          await toolbar.openPane('code')
          await editor.expectEditor.toContain(expectedEditedOutput)
          await toolbar.closePane('code')
        })

        await test.step('Delete helix via feature tree selection', async () => {
          await toolbar.openPane('feature-tree')
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Helix',
            0
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await editor.expectEditor.not.toContain(expectedEditedOutput)
          await expect(
            await toolbar.getFeatureTreeOperation('Helix', 0)
          ).not.toBeVisible()
        })
      })
    }
  )

  test('Helix point-and-click on cylinder', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = circle(
  sketch001,
  center = [0, 0],
  radius = 100,
  tag = $seg01,
)
extrude001 = extrude(profile001, length = 100)
    `
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 620, y: 257 }
    const [clickOnWall] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const expectedOutput = `helix001 = helix(  cylinder = extrude001,  revolutions = 1,  angleStart = 360,  ccw = false,)`
    const expectedLine = `cylinder = extrude001,`
    const expectedEditedOutput = `helix001 = helix(  cylinder = extrude001,  revolutions = 1,  angleStart = 360,  ccw = true,)`

    await test.step(`Go through the command bar flow`, async () => {
      await toolbar.helixButton.click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'mode',
        currentArgValue: '',
        headerArguments: {
          Mode: '',
          AngleStart: '',
          Revolutions: '',
          Radius: '',
          CounterClockWise: '',
        },
        highlightedHeaderArg: 'mode',
        commandName: 'Helix',
      })
      await cmdBar.selectOption({ name: 'Cylinder' }).click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'cylinder',
        currentArgValue: '',
        headerArguments: {
          Mode: 'Cylinder',
          Cylinder: '',
          AngleStart: '',
          Revolutions: '',
          CounterClockWise: '',
        },
        highlightedHeaderArg: 'cylinder',
        commandName: 'Helix',
      })
      await clickOnWall()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Mode: 'Cylinder',
          Cylinder: '1 face',
          AngleStart: '360',
          Revolutions: '1',
          CounterClockWise: '',
        },
        commandName: 'Helix',
      })
      await cmdBar.progressCmdBar()
    })

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await editor.expectEditor.toContain(expectedOutput)
      await editor.expectState({
        diagnostics: [],
        activeLines: [expectedLine],
        highlightedCode: '',
      })
    })

    await test.step(`Edit helix through the feature tree`, async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.dblclick()
      await cmdBar.expectState({
        commandName: 'Helix',
        stage: 'arguments',
        currentArgKey: 'CounterClockWise',
        currentArgValue: '',
        headerArguments: {
          AngleStart: '360',
          Revolutions: '1',
          CounterClockWise: '',
        },
        highlightedHeaderArg: 'CounterClockWise',
      })
      await cmdBar.selectOption({ name: 'True' }).click()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          AngleStart: '360',
          Revolutions: '1',
          CounterClockWise: 'true',
        },
        commandName: 'Helix',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
      await toolbar.openPane('code')
      await editor.expectEditor.toContain(expectedEditedOutput)
      await editor.closePane()
    })

    await test.step('Delete helix via feature tree selection', async () => {
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await toolbar.closePane('feature-tree')
      await toolbar.openPane('code')
      await editor.expectEditor.not.toContain(expectedEditedOutput)
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
      const initialCode = `sketch001 = startSketchOn(XZ)
    |> circle(center = [0, 0], radius = 30)
    plane001 = offsetPlane(XZ, offset = 50)
    sketch002 = startSketchOn(plane001)
    |> circle(center = [0, 0], radius = 20)
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
          await expect
            .poll(() => page.getByText('Please select one').count())
            .toBe(1)
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
        await page.keyboard.press('Delete')
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
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 30)
  plane001 = offsetPlane(XZ, offset = 50)
  sketch002 = startSketchOn(plane001)
  |> circle(center = [0, 0], radius = 20)
loft001 = loft([sketch001, sketch002])
`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 575, y: 200 }
    const [clickOnSketch1] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const [clickOnSketch2] = scene.makeMouseHelpers(
      testPoint.x,
      testPoint.y + 80
    )

    await test.step(`Delete loft`, async () => {
      // Check for loft
      await scene.expectPixelColor([89, 89, 89], testPoint, 15)
      await clickOnSketch1()
      await expect(page.locator('.cm-activeLine')).toHaveText(`
      |> circle(center = [0, 0], radius = 30)
    `)
      await page.keyboard.press('Delete')
      // Check for sketch 1
      await scene.expectPixelColor([254, 254, 254], testPoint, 15)
    })

    await test.step('Delete sketch002', async () => {
      await page.waitForTimeout(1000)
      await clickOnSketch2()
      await expect(page.locator('.cm-activeLine')).toHaveText(`
      |> circle(center = [0, 0], radius = 20)
    `)
      await page.keyboard.press('Delete')
      // Check for plane001
      await scene.expectPixelColor([228, 228, 228], testPoint, 15)
    })

    await test.step('Delete plane001', async () => {
      await page.waitForTimeout(1000)
      await clickOnSketch2()
      await expect(page.locator('.cm-activeLine')).toHaveText(`
      plane001 = offsetPlane(XZ, offset = 50)
    `)
      await page.keyboard.press('Delete')
      // Check for sketch 1
      await scene.expectPixelColor([254, 254, 254], testPoint, 15)
    })
  })

  const sweepCases = [
    {
      targetType: 'circle',
      testPoint: { x: 700, y: 250 },
      initialCode: `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(YZ)
profile001 = circle(sketch001, center = [0, 0], radius = 500)
sketch002 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> xLine(length = -500)
  |> tangentialArc(endAbsolute = [-2000, 500])`,
    },
    {
      targetType: 'rectangle',
      testPoint: { x: 710, y: 255 },
      initialCode: `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(YZ)
profile001 = startProfile(sketch001, at = [-400, -400])
  |> angledLine(angle = 0, length = 800, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90, length = 800)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> xLine(length = -500)
  |> tangentialArc(endAbsolute = [-2000, 500])`,
    },
  ]
  sweepCases.map(({ initialCode, targetType, testPoint }) => {
    test(`Sweep point-and-click ${targetType}`, async ({
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
      await scene.settled(cmdBar)

      // One dumb hardcoded screen pixel value
      const [clickOnSketch1] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
      const [clickOnSketch2] = scene.makeMouseHelpers(
        testPoint.x - 50,
        testPoint.y
      )
      const sweepDeclaration =
        'sweep001 = sweep(profile001, path = sketch002, sectional = false)'
      const editedSweepDeclaration =
        'sweep001 = sweep(profile001, path = sketch002, sectional = true)'

      await test.step(`Look for sketch001`, async () => {
        await toolbar.closePane('code')
        await scene.expectPixelColor([53, 53, 53], testPoint, 15)
      })

      await test.step(`Go through the command bar flow`, async () => {
        await toolbar.sweepButton.click()
        await expect
          .poll(() => page.getByText('Please select one').count())
          .toBe(1)
        await cmdBar.expectState({
          commandName: 'Sweep',
          currentArgKey: 'target',
          currentArgValue: '',
          headerArguments: {
            Sectional: '',
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
            Sectional: '',
            Target: '1 face',
            Trajectory: '',
          },
          highlightedHeaderArg: 'trajectory',
          stage: 'arguments',
        })
        await clickOnSketch2()
        await page.waitForTimeout(500)
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          commandName: 'Sweep',
          headerArguments: {
            Target: '1 face',
            Trajectory: '1 segment',
            Sectional: '',
          },
          stage: 'review',
        })
        await cmdBar.progressCmdBar()
      })

      await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(sweepDeclaration)
        await scene.expectPixelColor([120, 120, 120], testPoint, 40)
        await toolbar.closePane('code')
      })

      await test.step('Edit sweep via feature tree selection works', async () => {
        await toolbar.openPane('feature-tree')
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Sweep',
          0
        )
        await operationButton.dblclick({ button: 'left' })
        await cmdBar.expectState({
          commandName: 'Sweep',
          currentArgKey: 'sectional',
          currentArgValue: '',
          headerArguments: {
            Sectional: '',
          },
          highlightedHeaderArg: 'sectional',
          stage: 'arguments',
        })
        await cmdBar.selectOption({ name: 'True' }).click()
        await cmdBar.expectState({
          commandName: 'Sweep',
          headerArguments: {
            Sectional: '',
          },
          stage: 'review',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(editedSweepDeclaration)
        await toolbar.closePane('code')
      })

      await test.step('Delete sweep via feature tree selection', async () => {
        await toolbar.openPane('feature-tree')
        await page.waitForTimeout(500)
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Sweep',
          0
        )
        await operationButton.click({ button: 'left' })
        await page.keyboard.press('Delete')
        await page.waitForTimeout(500)
        await toolbar.closePane('feature-tree')
        await scene.expectPixelColor([53, 53, 53], testPoint, 15)
      })
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
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(YZ)
  |> circle(
       center = [0, 0],
       radius = 500
     )
sketch002 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> xLine(length = -500)
  |> line(endAbsolute = [-2000, 500])
`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 700, y: 250 }
    const [clickOnSketch1] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const [clickOnSketch2] = scene.makeMouseHelpers(
      testPoint.x - 50,
      testPoint.y
    )

    await test.step(`Look for sketch001`, async () => {
      await toolbar.closePane('code')
      await scene.expectPixelColor([53, 53, 53], testPoint, 15)
    })

    await test.step(`Go through the command bar flow and fail validation with a toast`, async () => {
      await toolbar.sweepButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
      await cmdBar.expectState({
        commandName: 'Sweep',
        currentArgKey: 'target',
        currentArgValue: '',
        headerArguments: {
          Sectional: '',
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
          Sectional: '',
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
    const initialCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -12)
`
    const firstFilletDeclaration = `fillet(radius=5,tags=[getCommonEdge(faces=[seg01,capEnd001])],)`
    const secondFilletDeclaration = `fillet(radius=5,tags=[getCommonEdge(faces=[seg01,capStart001])],)`

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
    const highTolerance = 70 // TODO: understand why I needed that for edgeColorYellow on macos (local)

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
      await editor.expectEditor.toContain(firstFilletDeclaration, {
        shouldNormalise: true,
      })
      await editor.expectState({
        diagnostics: [],
        activeLines: [')'],
        highlightedCode: '',
      })
    })

    await test.step(`Confirm scene has changed`, async () => {
      await scene.expectPixelColor(filletColor, firstEdgeLocation, lowTolerance)
    })

    // Test 1.1: Edit fillet (segment type)
    async function editFillet(
      featureTreeIndex: number,
      oldValue: string,
      newValue: string
    ) {
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Fillet',
        featureTreeIndex
      )
      await operationButton.dblclick({ button: 'left' })
      await cmdBar.expectState({
        commandName: 'Fillet',
        currentArgKey: 'radius',
        currentArgValue: oldValue,
        headerArguments: {
          Radius: oldValue,
        },
        highlightedHeaderArg: 'radius',
        stage: 'arguments',
      })
      await page.keyboard.insertText(newValue)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Radius: newValue,
        },
        commandName: 'Fillet',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
    }

    await test.step('Edit fillet via feature tree selection works', async () => {
      const firstFilletFeatureTreeIndex = 0
      const editedRadius = '1'
      await editFillet(firstFilletFeatureTreeIndex, '5', editedRadius)
      await editor.expectEditor.toContain(
        firstFilletDeclaration.replace('radius=5', 'radius=' + editedRadius),
        { shouldNormalise: true }
      )

      // Edit back to original radius
      await editFillet(firstFilletFeatureTreeIndex, editedRadius, '5')
      await editor.expectEditor.toContain(firstFilletDeclaration, {
        shouldNormalise: true,
      })
    })

    // Test 2: Command bar flow without preselected edges
    await test.step(`Open fillet UI without selecting edges`, async () => {
      await page.waitForTimeout(100)
      await toolbar.filletButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
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
      await editor.expectEditor.toContain(secondFilletDeclaration, {
        shouldNormalise: true,
      })
      await editor.expectState({
        diagnostics: [],
        activeLines: [')'],
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

    // Test 2.1: Edit fillet (edgeSweep type)
    await test.step('Edit fillet via feature tree selection works', async () => {
      const secondFilletFeatureTreeIndex = 1
      const editedRadius = '2'
      await editFillet(secondFilletFeatureTreeIndex, '5', editedRadius)
      await editor.expectEditor.toContain(
        secondFilletDeclaration.replace('radius=5', 'radius=' + editedRadius),
        { shouldNormalise: true }
      )

      // Edit back to original radius
      await editFillet(secondFilletFeatureTreeIndex, editedRadius, '5')
      await editor.expectEditor.toContain(secondFilletDeclaration, {
        shouldNormalise: true,
      })
    })

    // Test 3: Delete fillets
    await test.step('Delete fillet via feature tree selection', async () => {
      await test.step('Open Feature Tree Pane', async () => {
        await toolbar.openPane('feature-tree')
        await page.waitForTimeout(500)
      })
      await test.step('Delete fillet via feature tree selection', async () => {
        await editor.expectEditor.toContain(secondFilletDeclaration, {
          shouldNormalise: true,
        })
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Fillet',
          1
        )
        await operationButton.click({ button: 'left' })
        await page.keyboard.press('Delete')
        await page.waitForTimeout(500)
        await scene.expectPixelColor(edgeColorWhite, secondEdgeLocation, 15) // deleted
        await editor.expectEditor.not.toContain(secondFilletDeclaration)
        await scene.expectPixelColor(filletColor, firstEdgeLocation, 15) // stayed
      })
    })
  })

  test(`Fillet point-and-click edit rejected when not in pipe`, async ({
    context,
    page,
    homePage,
    scene,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = circle(
  sketch001,
  center = [0, 0],
  radius = 100,
  tag = $seg01,
)
extrude001 = extrude(profile001, length = 100)
fillet001 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])
`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step('Double-click in feature tree and expect error toast', async () => {
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation('Fillet', 0)
      await operationButton.dblclick({ button: 'left' })
      await expect(
        page.getByText(
          'Only chamfer and fillet in pipe expressions are supported for edits'
        )
      ).toBeVisible()
      await page.waitForTimeout(1000)
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
    const initialCode = `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0], tag = $seg02)
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(sketch001, length = -12)
  |> fillet(radius = 5, tags = [seg01]) // fillet01
  |> fillet(radius = 5, tags = [seg02]) // fillet02
fillet03 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])
fillet04 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg02)])
`
    const pipedFilletDeclaration = 'fillet(radius = 5, tags = [seg01])'
    const secondPipedFilletDeclaration = 'fillet(radius = 5, tags = [seg02])'
    const standaloneFilletDeclaration =
      'fillet03 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])'
    const secondStandaloneFilletDeclaration =
      'fillet04 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg02)])'

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
          await page.keyboard.press('Delete')
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
          await page.keyboard.press('Delete')
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

  test(`Fillet with large radius should update code even if engine fails`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    // Create a cube with small edges that will cause some fillets to fail
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = -1)
  |> xLine(length = -10)
  |> yLine(length = 10)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 5)
`
    const taggedSegment1 = `xLine(length = -10, tag = $seg01)`
    const taggedSegment2 = `yLine(length = -1, tag = $seg02)`
    const filletExpression = `fillet(radius = 1000, tags = [getCommonEdge(faces = [seg01, seg02])])`

    // Locators
    const edgeLocation = { x: 659, y: 313 }
    const bodyLocation = { x: 594, y: 313 }

    // Colors
    const edgeColorWhite: [number, number, number] = [248, 248, 248]
    const edgeColorYellow: [number, number, number] = [251, 251, 120] // Mac:B=251,251,90 Ubuntu:240,241,180, Windows:240,241,180
    const backgroundColor: [number, number, number] = [30, 30, 30]
    const bodyColor: [number, number, number] = [155, 155, 155]
    const lowTolerance = 20
    const highTolerance = 70

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()

      // verify modeling scene is loaded
      await scene.expectPixelColor(backgroundColor, edgeLocation, lowTolerance)

      // wait for stream to load
      await scene.expectPixelColor(bodyColor, bodyLocation, highTolerance)
    })

    // Test
    await test.step('Select edges and apply oversized fillet', async () => {
      await test.step(`Select the edge`, async () => {
        await scene.expectPixelColor(edgeColorWhite, edgeLocation, lowTolerance)
        const [clickOnTheEdge] = scene.makeMouseHelpers(
          edgeLocation.x,
          edgeLocation.y
        )
        await clickOnTheEdge()
        await scene.expectPixelColor(
          edgeColorYellow,
          edgeLocation,
          highTolerance // Ubuntu color mismatch can require high tolerance
        )
      })

      await test.step(`Apply fillet`, async () => {
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
            Selection: '1 sweepEdge',
            Radius: '',
          },
          stage: 'arguments',
        })
        // Set a large radius (1000)
        await cmdBar.currentArgumentInput.locator('.cm-content').fill('1000')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          commandName: 'Fillet',
          headerArguments: {
            Selection: '1 sweepEdge',
            Radius: '1000',
          },
          stage: 'review',
        })
        // Apply fillet with large radius
        await cmdBar.progressCmdBar()
      })
    })

    await test.step('Verify code is updated regardless of execution errors', async () => {
      await editor.expectEditor.toContain(taggedSegment1)
      await editor.expectEditor.toContain(taggedSegment2)
      await editor.expectEditor.toContain(filletExpression)
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
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = -12)
`
    const firstChamferDeclaration = `chamfer(length=5,tags=[getCommonEdge(faces=[seg01,capEnd001])],)`
    const secondChamferDeclaration = `chamfer(length=5,tags=[getCommonEdge(faces=[seg01,capStart001])],)`

    // Locators
    const firstEdgeLocation = { x: 600, y: 193 }
    const secondEdgeLocation = { x: 600, y: 383 }
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
    const chamferColor: [number, number, number] = [168, 168, 168]
    const backgroundColor: [number, number, number] = [30, 30, 30]
    const lowTolerance = 20
    const highTolerance = 70 // TODO: understand why I needed that for edgeColorYellow on macos (local)

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
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
      await page.waitForTimeout(1000)
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
      await cmdBar.argumentInput.focus()
      await page.waitForTimeout(1000)
      await cmdBar.progressCmdBar()
      await page.waitForTimeout(1000)
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
      await editor.expectEditor.toContain(firstChamferDeclaration, {
        shouldNormalise: true,
      })
      await editor.expectState({
        diagnostics: [],
        activeLines: [')'],
        highlightedCode: '',
      })
    })

    await test.step(`Confirm scene has changed`, async () => {
      await scene.expectPixelColor(
        chamferColor,
        firstEdgeLocation,
        lowTolerance
      )
    })

    // Test 1.1: Edit sweep
    async function editChamfer(
      featureTreeIndex: number,
      oldValue: string,
      newValue: string
    ) {
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Chamfer',
        featureTreeIndex
      )
      await operationButton.dblclick({ button: 'left' })
      await cmdBar.expectState({
        commandName: 'Chamfer',
        currentArgKey: 'length',
        currentArgValue: oldValue,
        headerArguments: {
          Length: oldValue,
        },
        highlightedHeaderArg: 'length',
        stage: 'arguments',
      })
      await page.keyboard.insertText(newValue)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Length: newValue,
        },
        commandName: 'Chamfer',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
    }

    await test.step('Edit chamfer via feature tree selection works', async () => {
      const firstChamferFeatureTreeIndex = 0
      const editedLength = '1'
      await editChamfer(firstChamferFeatureTreeIndex, '5', editedLength)
      await editor.expectEditor.toContain(
        firstChamferDeclaration.replace('length=5', 'length=' + editedLength),
        { shouldNormalise: true }
      )

      // Edit back to original radius
      await editChamfer(firstChamferFeatureTreeIndex, editedLength, '5')
      await editor.expectEditor.toContain(firstChamferDeclaration, {
        shouldNormalise: true,
      })
    })

    // Test 2: Command bar flow without preselected edges
    await test.step(`Open chamfer UI without selecting edges`, async () => {
      await page.waitForTimeout(100)
      await toolbar.chamferButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
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
      await editor.expectEditor.toContain(secondChamferDeclaration, {
        shouldNormalise: true,
      })
      await editor.expectState({
        diagnostics: [],
        activeLines: [')'],
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

    // Test 2.1: Edit chamfer (edgeSweep type)
    await test.step('Edit chamfer via feature tree selection works', async () => {
      const secondChamferFeatureTreeIndex = 1
      const editedLength = '2'
      await editChamfer(secondChamferFeatureTreeIndex, '5', editedLength)
      await editor.expectEditor.toContain(
        secondChamferDeclaration.replace('length=5', 'length=' + editedLength),
        { shouldNormalise: true }
      )

      // Edit back to original length
      await editChamfer(secondChamferFeatureTreeIndex, editedLength, '5')
      await editor.expectEditor.toContain(secondChamferDeclaration, {
        shouldNormalise: true,
      })
    })

    // Test 3: Delete chamfer via feature tree selection
    await test.step('Open Feature Tree Pane', async () => {
      await toolbar.openPane('feature-tree')
      await page.waitForTimeout(500)
    })
    await test.step('Delete chamfer via feature tree selection', async () => {
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Chamfer',
        1
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
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
    cmdBar,
  }) => {
    // Code samples
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XY)
  |> startProfile(at = [-12, -6])
  |> line(end = [0, 12])
  |> line(end = [24, 0], tag = $seg02)
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(sketch001, length = -12)
  |> chamfer(length = 5, tags = [seg01]) // chamfer01
  |> chamfer(length = 5, tags = [seg02]) // chamfer02
chamfer03 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])
chamfer04 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg02)])
`
    const pipedChamferDeclaration = 'chamfer(length = 5, tags = [seg01])'
    const secondPipedChamferDeclaration = 'chamfer(length = 5, tags = [seg02])'
    const standaloneChamferDeclaration =
      'chamfer03 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])'
    const secondStandaloneChamferDeclaration =
      'chamfer04 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg02)])'

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
      await scene.settled(cmdBar)

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
          await editor.expectEditor.toContain(
            secondStandaloneChamferDeclaration
          )
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
          await page.keyboard.press('Delete')
          await page.waitForTimeout(500)
        })
        await test.step('Verify piped chamfer is deleted but other chamfers are not (in the editor)', async () => {
          await editor.expectEditor.not.toContain(pipedChamferDeclaration)
          await editor.expectEditor.toContain(secondPipedChamferDeclaration)
          await editor.expectEditor.toContain(standaloneChamferDeclaration)
          await editor.expectEditor.toContain(
            secondStandaloneChamferDeclaration
          )
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
          await page.keyboard.press('Delete')
          await page.waitForTimeout(500)
        })
        await test.step('Verify non-piped chamfer is deleted but other two chamfers are not (in the editor)', async () => {
          await editor.expectEditor.toContain(secondPipedChamferDeclaration)
          await editor.expectEditor.not.toContain(standaloneChamferDeclaration)
          await editor.expectEditor.toContain(
            secondStandaloneChamferDeclaration
          )
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
      const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 30)
extrude001 = extrude(sketch001, length = 30)
    `
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)

      await page.setBodyDimensions({ width: 1000, height: 500 })

      await homePage.goToModelingScene()
      await scene.connectionEstablished()

      // One dumb hardcoded screen pixel value
      const testPoint = { x: 575, y: 200 }
      const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
      const shellDeclaration =
        'shell001 = shell(extrude001, faces = [END], thickness = 5)'
      const editedShellDeclaration =
        'shell001 = shell(extrude001, faces = [END], thickness = 2)'

      await test.step(`Look for the grey of the shape`, async () => {
        await scene.expectPixelColor([127, 127, 127], testPoint, 15)
      })

      if (!shouldPreselect) {
        await test.step(`Go through the command bar flow without preselected faces`, async () => {
          await toolbar.shellButton.click()
          await expect
            .poll(() => page.getByText('Please select one').count())
            .toBe(1)
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

      await test.step('Edit shell via feature tree selection works', async () => {
        await toolbar.openPane('feature-tree')
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Shell',
          0
        )
        await operationButton.dblclick()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'thickness',
          currentArgValue: '5',
          headerArguments: {
            Thickness: '5',
          },
          highlightedHeaderArg: 'thickness',
          commandName: 'Shell',
        })
        await page.keyboard.insertText('2')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Thickness: '2',
          },
          commandName: 'Shell',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
        await scene.expectPixelColor([150, 150, 150], testPoint, 15)
        await editor.expectEditor.toContain(editedShellDeclaration)
        await editor.expectState({
          diagnostics: [],
          activeLines: [editedShellDeclaration],
          highlightedCode: '',
        })
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
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XY)
  |> startProfile(at = [-20, 20])
  |> xLine(length = 40)
  |> yLine(length = -60)
  |> xLine(length = -40)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 40)
  `
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 580, y: 180 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const [clickOnWall] = scene.makeMouseHelpers(testPoint.x, testPoint.y + 70)
    const mutatedCode = 'xLine(length = -40, tag = $seg01)'
    const shellDeclaration =
      'shell001 = shell(extrude001, faces = [END, seg01], thickness = 5)'
    const editedShellDeclaration =
      'shell001 = shell(extrude001, faces = [END, seg01], thickness = 1)'

    await test.step(`Look for the grey of the shape`, async () => {
      await scene.expectPixelColor([99, 99, 99], testPoint, 15)
    })

    await test.step(`Go through the command bar flow, selecting a wall and keeping default thickness`, async () => {
      await toolbar.shellButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
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
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
      await clickOnCap()
      await page.keyboard.down('Shift')
      await clickOnWall()
      await page.waitForTimeout(500)
      await page.keyboard.up('Shift')
      await cmdBar.progressCmdBar()
      await page.waitForTimeout(500)
      await cmdBar.progressCmdBar()
      await page.waitForTimeout(500)
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Selection: '1 cap, 1 face',
          Thickness: '5',
        },
        commandName: 'Shell',
      })
      await page.waitForTimeout(500)
      await cmdBar.progressCmdBar()
      await page.waitForTimeout(500)
    })

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await editor.expectEditor.toContain(mutatedCode)
      await editor.expectEditor.toContain(shellDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [shellDeclaration],
        highlightedCode: '',
      })
      await scene.expectPixelColor([49, 49, 49], testPoint, 15)
    })

    await test.step('Edit shell via feature tree selection works', async () => {
      const operationButton = await toolbar.getFeatureTreeOperation('Shell', 0)
      await operationButton.dblclick({ button: 'left' })
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'thickness',
        currentArgValue: '5',
        headerArguments: {
          Thickness: '5',
        },
        highlightedHeaderArg: 'thickness',
        commandName: 'Shell',
      })
      await page.keyboard.insertText('1')
      await cmdBar.progressCmdBar()
      await page.waitForTimeout(500)
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Thickness: '1',
        },
        commandName: 'Shell',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
      await scene.expectPixelColor([150, 150, 150], testPoint, 15)
      await editor.expectEditor.toContain(editedShellDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [editedShellDeclaration],
        highlightedCode: '',
      })
    })

    await test.step('Delete shell via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Shell', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.expectPixelColor([99, 99, 99], testPoint, 15)
    })
  })

  const shellSketchOnFacesCases = [
    `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 100)
  |> extrude(length = 100)

sketch002 = startSketchOn(sketch001, face = 'END')
  |> circle(center = [0, 0], radius = 50)
  |> extrude(length = 50)
  `,
    `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 100)
extrude001 = extrude(sketch001, length = 100)

sketch002 = startSketchOn(extrude001, face = 'END')
  |> circle(center = [0, 0], radius = 50)
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
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      // One dumb hardcoded screen pixel value
      const testPoint = { x: 580, y: 320 }
      const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
      const shellTarget = hasExtrudesInPipe ? 'sketch002' : 'extrude002'
      const shellDeclaration = `shell001 = shell(${shellTarget}, faces = [END], thickness = 5)`

      await test.step(`Look for the grey of the shape`, async () => {
        await scene.expectPixelColor([113, 113, 113], testPoint, 15)
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
        await expect
          .poll(() => page.getByText('Please select one').count())
          .toBe(1)
        await clickOnCap()
        await page.waitForTimeout(1000)
        await cmdBar.progressCmdBar()
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

      await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(shellDeclaration)
        await editor.expectState({
          diagnostics: [],
          activeLines: [shellDeclaration],
          highlightedCode: '',
        })
        await toolbar.closePane('code')
        await scene.expectPixelColor([80, 80, 80], testPoint, 15)
      })
    })
  })

  const shellPointAndClickDeletionCases = [
    { shouldUseKeyboard: true },
    { shouldUseKeyboard: false },
  ]
  shellPointAndClickDeletionCases.forEach(({ shouldUseKeyboard }) => {
    test(`Shell point-and-click deletion (shouldUseKeyboard: ${shouldUseKeyboard})`, async ({
      context,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
    }) => {
      const sketchCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-20, 20])
    |> xLine(length = 40)
    |> yLine(length = -60)
    |> xLine(length = -40)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
`
      const extrudeCode = `extrude001 = extrude(profile001, length = 40)
`
      const shellCode = `shell001 = shell(extrude001, faces = [END], thickness = 5)
`
      const initialCode = sketchCode + extrudeCode + shellCode
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await toolbar.openPane('feature-tree')

      // One dumb hardcoded screen pixel value
      const testPoint = { x: 590, y: 400 }
      const extrudeColor: [number, number, number] = [100, 100, 100]
      const sketchColor: [number, number, number] = [140, 140, 140]
      const defaultPlaneColor: [number, number, number] = [88, 44, 45]

      const deleteOperation = async (operationButton: Locator) => {
        if (shouldUseKeyboard) {
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
        } else {
          await operationButton.click({ button: 'right' })
          const editButton = page.getByTestId('context-menu-delete')
          await editButton.click()
        }
      }

      await test.step(`Look for the grey of the extrude shape`, async () => {
        await scene.expectPixelColor(extrudeColor, testPoint, 20)
      })

      await test.step('Delete shell and confirm deletion', async () => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Shell',
          0
        )
        await deleteOperation(operationButton)
        await scene.expectPixelColor(extrudeColor, testPoint, 20)
        await editor.expectEditor.not.toContain(shellCode)
      })

      await test.step('Delete extrude and confirm deletion', async () => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Extrude',
          0
        )
        await deleteOperation(operationButton)
        await editor.expectEditor.not.toContain(extrudeCode)
        await scene.expectPixelColor(sketchColor, testPoint, 20)
      })

      await test.step('Delete sketch and confirm empty scene', async () => {
        const operationButton = await toolbar.getFeatureTreeOperation(
          'Sketch',
          0
        )
        await deleteOperation(operationButton)
        await editor.expectEditor.toContain('')
        // Cannot use test point anymore because the camera's position has been
        // reset and the rest of the test doesn't need to change just to check
        // if the scene is cleared.
        // Check that the scene is cleared
        await scene.expectPixelColor(defaultPlaneColor, { x: 574, y: 342 }, 20)
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
    const initialCode = `sketch001 = startSketchOn(YZ)
  |> circle(
       center = [0, 0],
       radius = 500
     )
sketch002 = startSketchOn(XZ)
    |> startProfile(at = [0, 0])
  |> xLine(length = -2000)
sweep001 = sweep(sketch001, path = sketch002)
`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 500, y: 250 }
    const [clickOnSweep] = scene.makeMouseHelpers(testPoint.x, testPoint.y)

    await test.step(`Confirm sweep exists`, async () => {
      await toolbar.closePane('code')
      await scene.expectPixelColor([231, 231, 231], testPoint, 15)
    })

    await test.step(`Go through the Shell flow and fail validation with a toast`, async () => {
      await toolbar.shellButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
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
sketch001 = startSketchOn(XZ)
|> startProfile(at = [-100.0, 100.0])
|> angledLine(angle = 0, length = 200.0, tag = $rectangleSegmentA001)
|> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 200, tag = $rectangleSegmentB001)
|> angledLine(
angle=segAng(rectangleSegmentA001),
length=-segLen(rectangleSegmentA001),
tag=$rectangleSegmentC001,
)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
extrude001 = extrude(sketch001, length = 200)
sketch002 = startSketchOn(extrude001, face = rectangleSegmentA001)
|> startProfile(at = [-66.77, 84.81])
|> angledLine(angle = 180, length = 27.08, tag = $rectangleSegmentA002)
|> angledLine(
angle=segAng(rectangleSegmentA002) - 90,
length=27.8,
tag=$rectangleSegmentB002,
)
|> angledLine(
angle=segAng(rectangleSegmentA002),
length=-segLen(rectangleSegmentA002),
tag=$rectangleSegmentC002,
)
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
`

      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      // select line of code
      const codeToSelection = `segAng(rectangleSegmentA002) - 90,`
      // revolve
      await editor.scrollToText(codeToSelection)
      await page.getByText(codeToSelection).click()
      await toolbar.revolveButton.click()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()

      const newCodeToFind = `revolve001 = revolve(sketch002, angle = 360, axis = X)`
      expect(editor.expectEditor.toContain(newCodeToFind)).toBeTruthy()

      // Edit flow
      const newAngle = '90'
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Revolve',
        0
      )
      await operationButton.dblclick({ button: 'left' })
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'angle',
        currentArgValue: '360',
        headerArguments: {
          Angle: '360',
        },
        highlightedHeaderArg: 'angle',
        stage: 'arguments',
      })
      await page.keyboard.insertText(newAngle)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Angle: newAngle,
        },
        commandName: 'Revolve',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
      await editor.expectEditor.toContain(
        newCodeToFind.replace('angle = 360', 'angle = ' + newAngle)
      )
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
      const initialCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [-102.57, 101.72])
  |> angledLine(angle = 0, length = 202.6, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 202.6, tag = $rectangleSegmentB001)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 50)
sketch002 = startSketchOn(extrude001, face = rectangleSegmentA001)
  |> circle(center = [-11.34, 10.0], radius = 8.69)

`
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.connectionEstablished()
      await scene.settled(cmdBar)

      // select line of code
      const codeToSelection = `center = [-11.34, 10.0]`
      // revolve
      await editor.scrollToText(codeToSelection)
      await page.getByText(codeToSelection).click()
      await toolbar.revolveButton.click()
      await page.getByText('Edge', { exact: true }).click()
      const lineCodeToSelection = `angledLine(angle = 0, length = 202.6, tag = $rectangleSegmentA001)`
      await page.getByText(lineCodeToSelection).click()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()

      const newCodeToFind = `revolve001 = revolve(sketch002, angle = 360, axis = rectangleSegmentA001)`
      await editor.expectEditor.toContain(newCodeToFind)

      // Edit flow
      const newAngle = '180'
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Revolve',
        0
      )
      await operationButton.dblclick({ button: 'left' })
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'angle',
        currentArgValue: '360',
        headerArguments: {
          Angle: '360',
        },
        highlightedHeaderArg: 'angle',
        stage: 'arguments',
      })
      await page.keyboard.insertText(newAngle)
      await page.getByRole('button', { name: 'Create new variable' }).click()
      await expect(page.getByPlaceholder('Variable name')).toHaveValue(
        'angle001'
      )
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Angle: newAngle,
        },
        commandName: 'Revolve',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
      await editor.expectEditor.toContain('angle001 = ' + newAngle)
      await editor.expectEditor.toContain(
        newCodeToFind.replace('angle = 360', 'angle = angle001')
      )
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
    sketch002 = startSketchOn(XY)
      |> startProfile(at = [-2.02, 1.79])
      |> xLine(length = 2.6)
    sketch001 = startSketchOn(-XY)
      |> startProfile(at = [-0.48, 1.25])
      |> angledLine(angle = 0, length = 2.38, tag = $rectangleSegmentA001)
      |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 2.4, tag = $rectangleSegmentB001)
      |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $rectangleSegmentC001)
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    extrude001 = extrude(sketch001, length = 5)
    sketch003 = startSketchOn(extrude001, face = 'START')
      |> circle(
        center = [-0.69, 0.56],
        radius = 0.28
      )
`

      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.connectionEstablished()
      await scene.settled(cmdBar)

      // select line of code
      const codeToSelection = `center = [-0.69, 0.56]`
      // revolve
      await toolbar.revolveButton.click()
      await page.waitForTimeout(1000)
      await editor.scrollToText(codeToSelection)
      await page.getByText(codeToSelection).click()
      await expect.poll(() => page.getByText('AxisOrEdge').count()).toBe(2)
      await page.getByText('Edge', { exact: true }).click()
      const lineCodeToSelection = `length = 2.6`
      await editor.scrollToText(lineCodeToSelection)
      await page.getByText(lineCodeToSelection).click()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()

      const newCodeToFind = `revolve001 = revolve(sketch003, angle = 360, axis = seg01)`
      expect(editor.expectEditor.toContain(newCodeToFind)).toBeTruthy()

      // Edit flow
      const newAngle = '270'
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Revolve',
        0
      )
      await operationButton.dblclick({ button: 'left' })
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'angle',
        currentArgValue: '360',
        headerArguments: {
          Angle: '360',
        },
        highlightedHeaderArg: 'angle',
        stage: 'arguments',
      })
      await page.keyboard.insertText(newAngle)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Angle: newAngle,
        },
        commandName: 'Revolve',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
      await editor.expectEditor.toContain(
        newCodeToFind.replace('angle = 360', 'angle = ' + newAngle)
      )
    })
  })

  test(`Set appearance`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = circle(
  sketch001,
  center = [0, 0],
  radius = 100
)
extrude001 = extrude(profile001, length = 100)
`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 500, y: 250 }
    const initialColor: [number, number, number] = [123, 123, 123]
    const tolerance = 50

    await test.step(`Confirm extrude exists with default appearance`, async () => {
      await toolbar.closePane('code')
      await scene.expectPixelColor(initialColor, testPoint, tolerance)
    })

    async function setApperanceAndCheck(
      option: string,
      hex: string,
      shapeColor?: [number, number, number]
    ) {
      await toolbar.openPane('feature-tree')
      const enterAppearanceFlow = async (stepName: string) =>
        test.step(stepName, async () => {
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Extrude',
            0
          )
          await operationButton.click({ button: 'right' })
          const menuButton = page.getByTestId('context-menu-set-appearance')
          await menuButton.click()
          await cmdBar.expectState({
            commandName: 'Appearance',
            currentArgKey: 'color',
            currentArgValue: '',
            headerArguments: {
              Color: '',
            },
            highlightedHeaderArg: 'color',
            stage: 'arguments',
          })
        })

      await enterAppearanceFlow(`Open Set Appearance flow`)

      await test.step(`Validate hidden argument "nodeToEdit" can't be reached with Backspace`, async () => {
        await page.keyboard.press('Shift+Backspace')
        await cmdBar.expectState({
          stage: 'pickCommand',
        })
        await page.keyboard.press('Escape')
        await cmdBar.expectState({
          stage: 'commandBarClosed',
        })
      })

      await enterAppearanceFlow(`Restart Appearance flow`)
      const item = page.getByText(option, { exact: true })
      await item.click()
      await cmdBar.expectState({
        commandName: 'Appearance',
        headerArguments: {
          Color: hex,
        },
        stage: 'review',
      })
      await cmdBar.progressCmdBar()
      await toolbar.closePane('feature-tree')
      if (shapeColor) {
        await scene.expectPixelColor(shapeColor, testPoint, tolerance)
      }
      await toolbar.openPane('code')
      if (hex === 'default') {
        const anyAppearanceDeclaration = `|> appearance(`
        await editor.expectEditor.not.toContain(anyAppearanceDeclaration)
      } else {
        const declaration = `|> appearance(%, color = '${hex}')`
        await editor.expectEditor.toContain(declaration)
        // TODO: fix selection range after appearance update
        // await editor.expectState({
        //   diagnostics: [],
        //   activeLines: [declaration],
        //   highlightedCode: '',
        // })
      }
      await toolbar.closePane('code')
    }

    await test.step(`Go through the Set Appearance flow for all options`, async () => {
      await setApperanceAndCheck('Red', '#FF0000', [180, 30, 30])
      // Not checking the scene color every time cause that's not really deterministic. Red seems reliable though
      await setApperanceAndCheck('Green', '#00FF00')
      await setApperanceAndCheck('Blue', '#0000FF')
      await setApperanceAndCheck('Turquoise', '#00FFFF')
      await setApperanceAndCheck('Purple', '#FF00FF')
      await setApperanceAndCheck('Yellow', '#FFFF00')
      await setApperanceAndCheck('Black', '#000000')
      await setApperanceAndCheck('Dark Grey', '#080808')
      await setApperanceAndCheck('Light Grey', '#D3D3D3')
      await setApperanceAndCheck('White', '#FFFFFF')
      await setApperanceAndCheck(
        'Default (clear appearance)',
        'default',
        initialColor
      )
    })
  })

  const translateExtrudeCases: { variables: boolean }[] = [
    {
      variables: false,
    },
    {
      variables: true,
    },
  ]
  translateExtrudeCases.map(({ variables }) => {
    test(`Set translate on extrude through right-click menu (variables: ${variables})`, async ({
      context,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
    }) => {
      const initialCode = `sketch001 = startSketchOn(XZ)
    profile001 = circle(sketch001, center = [0, 0], radius = 1)
    extrude001 = extrude(profile001, length = 1)
    `
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      // One dumb hardcoded screen pixel value
      const midPoint = { x: 500, y: 250 }
      const moreToTheRightPoint = { x: 800, y: 250 }
      const bgColor: [number, number, number] = [50, 50, 50]
      const partColor: [number, number, number] = [150, 150, 150]
      const tolerance = 50

      await test.step('Confirm extrude exists with default appearance', async () => {
        await toolbar.closePane('code')
        await scene.expectPixelColor(partColor, midPoint, tolerance)
        await scene.expectPixelColor(bgColor, moreToTheRightPoint, tolerance)
      })

      await test.step('Set translate through command bar flow', async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('Extrude', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-translate').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'x',
          currentArgValue: '0',
          headerArguments: {
            X: '',
            Y: '',
            Z: '',
          },
          highlightedHeaderArg: 'x',
          commandName: 'Translate',
        })
        await page.keyboard.insertText('3')
        if (variables) {
          await cmdBar.createNewVariable()
        }
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('0.1')
        if (variables) {
          await cmdBar.createNewVariable()
        }
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('0.2')
        if (variables) {
          await cmdBar.createNewVariable()
        }
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            X: '3',
            Y: '0.1',
            Z: '0.2',
          },
          commandName: 'Translate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
      })

      await test.step('Confirm code and scene have changed', async () => {
        await toolbar.openPane('code')
        if (variables) {
          await editor.expectEditor.toContain(
            `
            z001 = 0.2
            y001 = 0.1
            x001 = 3
            sketch001 = startSketchOn(XZ)
            profile001 = circle(sketch001, center = [0, 0], radius = 1)
            extrude001 = extrude(profile001, length = 1)
              |> translate(x = x001, y = y001, z = z001)
          `,
            { shouldNormalise: true }
          )
        } else {
          await editor.expectEditor.toContain(
            `
            sketch001 = startSketchOn(XZ)
            profile001 = circle(sketch001, center = [0, 0], radius = 1)
            extrude001 = extrude(profile001, length = 1)
              |> translate(x = 3, y = 0.1, z = 0.2)
          `,
            { shouldNormalise: true }
          )
        }
        await scene.expectPixelColor(bgColor, midPoint, tolerance)
        await scene.expectPixelColor(partColor, moreToTheRightPoint, tolerance)
      })

      await test.step('Edit translate', async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('Extrude', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-translate').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'z',
          currentArgValue: variables ? 'z001' : '0.2',
          headerArguments: {
            X: '3',
            Y: '0.1',
            Z: '0.2',
          },
          highlightedHeaderArg: 'z',
          commandName: 'Translate',
        })
        await page.keyboard.insertText('0.3')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            X: '3',
            Y: '0.1',
            Z: '0.3',
          },
          commandName: 'Translate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(`z = 0.3`)
        // Expect almost no change in scene
        await scene.expectPixelColor(bgColor, midPoint, tolerance)
        await scene.expectPixelColor(partColor, moreToTheRightPoint, tolerance)
      })
    })
  })

  const rotateExtrudeCases: { variables: boolean }[] = [
    {
      variables: false,
    },
    {
      variables: true,
    },
  ]
  rotateExtrudeCases.map(({ variables }) => {
    test(`Set rotate on extrude through right-click menu (variables: ${variables})`, async ({
      context,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
    }) => {
      const initialCode = `sketch001 = startSketchOn(XZ)
    profile001 = circle(sketch001, center = [0, 0], radius = 1)
    extrude001 = extrude(profile001, length = 1)
    `
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      await test.step('Set rotate through command bar flow', async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('Extrude', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-rotate').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'roll',
          currentArgValue: '0',
          headerArguments: {
            Roll: '',
            Pitch: '',
            Yaw: '',
          },
          highlightedHeaderArg: 'roll',
          commandName: 'Rotate',
        })
        await page.keyboard.insertText('1.1')
        if (variables) {
          await cmdBar.createNewVariable()
        }
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('1.2')
        if (variables) {
          await cmdBar.createNewVariable()
        }
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('1.3')
        if (variables) {
          await cmdBar.createNewVariable()
        }
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Roll: '1.1',
            Pitch: '1.2',
            Yaw: '1.3',
          },
          commandName: 'Rotate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
      })

      await test.step('Confirm code and scene have changed', async () => {
        await toolbar.openPane('code')
        if (variables) {
          await editor.expectEditor.toContain(
            `
            yaw001 = 1.3
            pitch001 = 1.2
            roll001 = 1.1
            sketch001 = startSketchOn(XZ)
            profile001 = circle(sketch001, center = [0, 0], radius = 1)
            extrude001 = extrude(profile001, length = 1)
              |> rotate(roll = roll001, pitch = pitch001, yaw = yaw001)
          `,
            { shouldNormalise: true }
          )
        } else {
          await editor.expectEditor.toContain(
            `
            sketch001 = startSketchOn(XZ)
            profile001 = circle(sketch001, center = [0, 0], radius = 1)
            extrude001 = extrude(profile001, length = 1)
              |> rotate(roll = 1.1, pitch = 1.2, yaw = 1.3)
          `,
            { shouldNormalise: true }
          )
        }
      })

      await test.step('Edit rotate', async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('Extrude', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-rotate').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'yaw',
          currentArgValue: variables ? 'yaw001' : '1.3',
          headerArguments: {
            Roll: '1.1',
            Pitch: '1.2',
            Yaw: '1.3',
          },
          highlightedHeaderArg: 'yaw',
          commandName: 'Rotate',
        })
        await page.keyboard.insertText('13')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Roll: '1.1',
            Pitch: '1.2',
            Yaw: '13',
          },
          commandName: 'Rotate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(`yaw = 13`)
      })
    })
  })

  test(`Set translate and rotate on extrude through selection`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
  `
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const midPoint = { x: 500, y: 250 }
    const moreToTheRightPoint = { x: 800, y: 250 }
    const bgColor: [number, number, number] = [50, 50, 50]
    const partColor: [number, number, number] = [150, 150, 150]
    const tolerance = 50
    const [clickMidPoint] = scene.makeMouseHelpers(midPoint.x, midPoint.y)
    const [clickMoreToTheRightPoint] = scene.makeMouseHelpers(
      moreToTheRightPoint.x,
      moreToTheRightPoint.y
    )

    await test.step('Confirm extrude exists with default appearance', async () => {
      await toolbar.closePane('code')
      await scene.expectPixelColor(partColor, midPoint, tolerance)
      await scene.expectPixelColor(bgColor, moreToTheRightPoint, tolerance)
    })

    await test.step('Set translate through command bar flow', async () => {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Translate')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'selection',
        currentArgValue: '',
        headerArguments: {
          Selection: '',
          X: '',
          Y: '',
          Z: '',
        },
        highlightedHeaderArg: 'selection',
        commandName: 'Translate',
      })
      await clickMidPoint()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'x',
        currentArgValue: '0',
        headerArguments: {
          Selection: '1 path',
          X: '',
          Y: '',
          Z: '',
        },
        highlightedHeaderArg: 'x',
        commandName: 'Translate',
      })
      await page.keyboard.insertText('2')
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Selection: '1 path',
          X: '2',
          Y: '0',
          Z: '0',
        },
        commandName: 'Translate',
      })
      await cmdBar.progressCmdBar()
    })

    await test.step('Confirm code and scene have changed', async () => {
      await toolbar.openPane('code')
      await editor.expectEditor.toContain(
        `
        sketch001 = startSketchOn(XZ)
        profile001 = circle(sketch001, center = [0, 0], radius = 1)
        extrude001 = extrude(profile001, length = 1)
          |> translate(x = 2, y = 0, z = 0)
          `,
        { shouldNormalise: true }
      )
      await scene.expectPixelColor(bgColor, midPoint, tolerance)
      await scene.expectPixelColor(partColor, moreToTheRightPoint, tolerance)
    })

    await test.step('Set rotate through command bar flow', async () => {
      // clear selection
      await clickMidPoint()
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Rotate')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'selection',
        currentArgValue: '',
        headerArguments: {
          Selection: '',
          Roll: '',
          Pitch: '',
          Yaw: '',
        },
        highlightedHeaderArg: 'selection',
        commandName: 'Rotate',
      })
      await clickMoreToTheRightPoint()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'roll',
        currentArgValue: '0',
        headerArguments: {
          Selection: '1 path',
          Roll: '',
          Pitch: '',
          Yaw: '',
        },
        highlightedHeaderArg: 'roll',
        commandName: 'Rotate',
      })
      await page.keyboard.insertText('0.1')
      await cmdBar.progressCmdBar()
      await page.keyboard.insertText('0.2')
      await cmdBar.progressCmdBar()
      await page.keyboard.insertText('0.3')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Selection: '1 path',
          Roll: '0.1',
          Pitch: '0.2',
          Yaw: '0.3',
        },
        commandName: 'Rotate',
      })
      await cmdBar.progressCmdBar()
    })

    await test.step('Confirm code has changed', async () => {
      await toolbar.openPane('code')
      await editor.expectEditor.toContain(
        `
        sketch001 = startSketchOn(XZ)
        profile001 = circle(sketch001, center = [0, 0], radius = 1)
        extrude001 = extrude(profile001, length = 1)
          |> translate(x = 2, y = 0, z = 0)
          |> rotate(roll = 0.1, pitch = 0.2, yaw = 0.3)
          `,
        { shouldNormalise: true }
      )
      // No change here since the angles are super small
      await scene.expectPixelColor(bgColor, midPoint, tolerance)
      await scene.expectPixelColor(partColor, moreToTheRightPoint, tolerance)
    })
  })

  test('Point-and-click Clone extrude through selection', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
  `
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    const midPoint = { x: 500, y: 250 }
    const [clickMidPoint] = scene.makeMouseHelpers(midPoint.x, midPoint.y)

    await test.step('Clone through command bar flow', async () => {
      await toolbar.closePane('code')
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Clone a solid or sketch')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'selection',
        currentArgValue: '',
        headerArguments: {
          Selection: '',
          VariableName: '',
        },
        highlightedHeaderArg: 'selection',
        commandName: 'Clone',
      })
      await clickMidPoint()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'variableName',
        currentArgValue: '',
        headerArguments: {
          Selection: '1 path',
          VariableName: '',
        },
        highlightedHeaderArg: 'variableName',
        commandName: 'Clone',
      })
      await page.keyboard.insertText('yoyoyo')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Selection: '1 path',
          VariableName: 'yoyoyo',
        },
        commandName: 'Clone',
      })
      await cmdBar.progressCmdBar()

      // Expect changes
      await toolbar.openPane('code')
      await editor.expectEditor.toContain(
        `
        sketch001 = startSketchOn(XZ)
        profile001 = circle(sketch001, center = [0, 0], radius = 1)
        extrude001 = extrude(profile001, length = 1)
        yoyoyo = clone(extrude001)
          `,
        { shouldNormalise: true }
      )
    })
  })
})
