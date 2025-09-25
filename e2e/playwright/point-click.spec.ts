import type { Page } from '@playwright/test'

import { bracket } from '@e2e/playwright/fixtures/bracket'
import type { CmdBarSerialised } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { expect, test } from '@e2e/playwright/zoo-test'

// test file is for testing point an click code gen functionality that's not sketch mode related

test.describe('Point-and-click tests', () => {
  test('Verify in-pipe extrudes in bracket can be edited', async ({
    tronApp,
    context,
    editor,
    homePage,
    page,
    scene,
    toolbar,
    cmdBar,
  }) => {
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, bracket)
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step(`Edit first extrude via feature tree`, async () => {
      await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: 'width',
        headerArguments: {
          Length: '5',
        },
        highlightedHeaderArg: 'length',
        commandName: 'Extrude',
      })
      await page.keyboard.insertText('width - 0.001in')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Length: '4.999in',
        },
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()
      await editor.expectEditor.toContain('extrude(length = width - 0.001in)')
    })

    await test.step(`Edit second extrude via feature tree`, async () => {
      await (await toolbar.getFeatureTreeOperation('Extrude', 1)).dblclick()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '-thickness - .01',
        headerArguments: {
          Length: '-0.3949',
        },
        highlightedHeaderArg: 'length',
        commandName: 'Extrude',
      })
      await page.keyboard.insertText('-thickness - .01 - 0.001')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Length: '-0.3959',
        },
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()
      await editor.expectEditor.toContain(
        'extrude(length = -thickness - .01 - 0.001)'
      )
    })

    await test.step(`Edit third extrude via feature tree`, async () => {
      await (await toolbar.getFeatureTreeOperation('Extrude', 2)).dblclick()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '-thickness - 0.1',
        headerArguments: {
          Length: '-0.4849',
        },
        highlightedHeaderArg: 'length',
        commandName: 'Extrude',
      })
      await page.keyboard.insertText('-thickness - 0.1 - 0.001')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Length: '-0.4859',
        },
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()
      await editor.expectEditor.toContain(
        'extrude(length = -thickness - 0.1 - 0.001)'
      )
    })
  })

  test('Create an Extrude operation with a tag and edit it via Feature Tree', async ({
    context,
    editor,
    homePage,
    page,
    scene,
    toolbar,
    cmdBar,
  }) => {
    const code = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, code)
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step('Add extrude with tags', async () => {
      await toolbar.extrudeButton.click()
      await editor.selectText('circle')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '5',
        headerArguments: {
          Profiles: '1 profile',
          Length: '',
        },
        highlightedHeaderArg: 'length',
        commandName: 'Extrude',
      })
      await page.keyboard.insertText('4')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Length: '4',
          Profiles: '1 profile',
        },
        commandName: 'Extrude',
      })
      await cmdBar.clickOptionalArgument('tagEnd')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'tagEnd$',
        currentArgValue: '',
        headerArguments: {
          Length: '4',
          Profiles: '1 profile',
          TagEnd: '',
        },
        highlightedHeaderArg: 'tagEnd',
        commandName: 'Extrude',
      })
      await page.keyboard.insertText('myEndTag')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Length: '4',
          Profiles: '1 profile',
          TagEnd: 'myEndTag',
        },
        commandName: 'Extrude',
      })
      await cmdBar.submit()
      await editor.expectEditor.toContain(
        'extrude(profile001, length = 4, tagEnd = $myEndTag)'
      )
    })

    await test.step(`Edit first extrude via feature tree`, async () => {
      await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '4',
        headerArguments: {
          Length: '4',
          TagEnd: 'myEndTag',
        },
        highlightedHeaderArg: 'length',
        commandName: 'Extrude',
      })
      await page.keyboard.insertText('3')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Length: '3',
          TagEnd: 'myEndTag',
        },
        commandName: 'Extrude',
      })
      await cmdBar.progressCmdBar()
      await editor.expectEditor.toContain(
        'extrude(profile001, length = 3, tagEnd = $myEndTag)'
      )
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
          await toolbar.waitForFeatureTreeToBeBuilt()
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
          await toolbar.waitForFeatureTreeToBeBuilt()
        })
      }
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
    } as const
    const xAxisSloppy = {
      screen: [
        viewPortSize.width * 0.75,
        viewPortSize.height / 2 - 3, // 3px off the X-axis
      ],
    } as const
    const offYAxis = {
      screen: [
        viewPortSize.width * 0.6, // Well off the Y-axis, out of snapping range
        viewPortSize.height * 0.3,
      ],
    } as const
    const yAxisSloppy = {
      screen: [
        viewPortSize.width / 2 + 5, // 5px off the Y-axis
        viewPortSize.height * 0.3,
      ],
    } as const
    const [clickOnXzPlane, moveToXzPlane] = scene.makeMouseHelpers(...xzPlane)
    const [clickOriginSloppy] = scene.makeMouseHelpers(...originSloppy.screen)
    const [clickXAxisSloppy, moveXAxisSloppy] = scene.makeMouseHelpers(
      ...xAxisSloppy.screen
    )
    const [dragToOffYAxis, dragFromOffAxis] = scene.makeDragHelpers(
      ...offYAxis.screen,
      { debug: true }
    )

    const expectedCodeSnippets = {
      sketchOnXzPlane: 'sketch001 = startSketchOn(XZ)',
      pointAtOrigin: 'startProfile(sketch001, at = [0, 0])',
      segmentOnXAxis: 'xLine(length',
      afterSegmentDraggedOnYAxis:
        /startProfile\(sketch001, at = \[0, (\d+(\.\d+)?)\]\)/,
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
      await editor.closePane()
      await dragToOffYAxis({
        fromPoint: { x: originSloppy.screen[0], y: originSloppy.screen[1] },
      })
      await editor.expectEditor.not.toContain(
        expectedCodeSnippets.pointAtOrigin
      )
    })
    await test.step(`Drag the origin point left to the y-axis, verify it snaps back`, async () => {
      await dragFromOffAxis({
        toPoint: { x: yAxisSloppy.screen[0], y: yAxisSloppy.screen[1] },
      })
      await editor.openPane()
      await expect(editor.codeContent).toContainText(
        expectedCodeSnippets.afterSegmentDraggedOnYAxis
      )
      await editor.closePane()
    })
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

    await context.addInitScript((code) => {
      localStorage.setItem('persistCode', code)
    }, initialCode)

    await homePage.goToModelingScene()

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_clickOpenPath, moveToOpenPath, dblClickOpenPath] =
      scene.makeMouseHelpers(0.65, 0.5, { format: 'ratio' })
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_clickCircle, moveToCircle, dblClickCircle] = scene.makeMouseHelpers(
      0.63,
      0.5,
      { format: 'ratio' }
    )

    await test.step(`Double-click on the closed sketch`, async () => {
      await scene.settled(cmdBar)
      await editor.closePane()
      await moveToCircle()
      await page.waitForTimeout(1000)
      await dblClickCircle()
      await page.waitForTimeout(1000)
      await expect(toolbar.exitSketchBtn).toBeVisible()
      await editor.openPane()
      await editor.expectState({
        activeLines: [`|>circle(center=[8,5],radius=2)`],
        highlightedCode: '',
        diagnostics: [],
      })
    })
    await page.waitForTimeout(1000)

    await toolbar.exitSketch()
    await page.waitForTimeout(1000)
    await editor.closePane()

    // Drag the sketch line out of the axis view which blocks the click
    await page.dragAndDrop('#stream', '#stream', {
      sourcePosition: await scene.convertPagePositionToStream(
        0.7,
        0.5,
        'ratio'
      ),
      targetPosition: await scene.convertPagePositionToStream(
        0.7,
        0.4,
        'ratio'
      ),
    })

    await page.waitForTimeout(500)

    await test.step(`Double-click on the open sketch`, async () => {
      await moveToOpenPath()
      // There is a full execution after exiting sketch that clears the scene.
      await page.waitForTimeout(500)
      await dblClickOpenPath()
      await expect(toolbar.exitSketchBtn).toBeVisible()
      // Wait for enter sketch mode to complete
      await page.waitForTimeout(500)
      await editor.openPane()
      await editor.expectState({
        activeLines: [`|>tangentialArc(endAbsolute=[10,0])`],
        highlightedCode: '',
        diagnostics: [],
      })
    })
  })

  test(`Shift-click to select and deselect edges and faces`, async ({
    context,
    cmdBar,
    toolbar,
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
    const upperEdgeLocation = { x: 600, y: 193 }
    const lowerEdgeLocation = { x: 600, y: 383 }
    const faceLocation = { x: 630, y: 290 }
    const timeout = 150

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await toolbar.closePane('code')
      await scene.settled(cmdBar)
    })

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

    await test.step('Select and deselect a single edge', async () => {
      await expect(toolbar.selectionStatus).toContainText('No selection')
      await test.step('Click the edge', async () => {
        await clickOnUpperEdge()
        await expect(toolbar.selectionStatus).toContainText('1 segment')
      })
      await test.step('Shift-click the same edge to deselect', async () => {
        await page.keyboard.down('Shift')
        await clickOnUpperEdge()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await expect(toolbar.selectionStatus).toContainText('No selection')
      })
    })

    await test.step('Select and deselect multiple objects', async () => {
      await test.step('Select both edges and the face', async () => {
        await test.step('Select the upper edge', async () => {
          await clickOnUpperEdge()
          await expect(toolbar.selectionStatus).toContainText('1 segment')
        })
        await test.step('Select the lower edge (Shift-click)', async () => {
          await page.keyboard.down('Shift')
          await clickOnLowerEdge()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await expect(toolbar.selectionStatus).toContainText(
            '1 segment, 1 sweepEdge'
          )
        })
        await test.step('Select the face (Shift-click)', async () => {
          await page.keyboard.down('Shift')
          await clickOnFace()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await expect(toolbar.selectionStatus).toContainText(
            '1 segment, 1 sweepEdge, 1 face'
          )
        })
      })
      await test.step('Deselect them one by one', async () => {
        await test.step('Deselect the face (Shift-click)', async () => {
          await page.keyboard.down('Shift')
          await clickOnFace()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await expect(toolbar.selectionStatus).toContainText(
            '1 segment, 1 sweepEdge'
          )
        })
        await test.step('Deselect the lower edge (Shift-click)', async () => {
          await page.keyboard.down('Shift')
          await clickOnLowerEdge()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await expect(toolbar.selectionStatus).toContainText('1 segment')
        })
        await test.step('Deselect the upper edge (Shift-click)', async () => {
          await page.keyboard.down('Shift')
          await clickOnUpperEdge()
          await page.waitForTimeout(timeout)
          await page.keyboard.up('Shift')
          await expect(toolbar.selectionStatus).toContainText('No selection')
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
    // @pierremtb: moved the select location to the arrow at the end after the engine zoom fix
    // got in https://github.com/KittyCAD/engine/pull/3804, seemed like it allowed for more
    // error margin but unclear why
    const firstSegmentLocation = { x: 799, y: 100 }
    const secondSegmentLocation = { x: 800, y: 399 }
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
      firstSegmentLocation.x,
      firstSegmentLocation.y
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
    // @pierremtb: had to tone these colors down a bit after the engine zoom fix
    // in https://github.com/KittyCAD/engine/pull/3804, unclear why
    const edgeColorWhite: [number, number, number] = [150, 150, 150]
    const edgeColorBlue: [number, number, number] = [10, 10, 150]
    const backgroundColor: [number, number, number] = [30, 30, 30]
    const tolerance = 50
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
        // @pierremtb: I believe we can't click too fast after deselecting the line tool,
        // otherwise the segment gets instantly deselected again.
        // There's a non-zero chance it's an actual bug.
        await page.waitForTimeout(timeout * 5)
        await clickFirstSegment()
        await page.waitForTimeout(timeout)
        await scene.expectPixelColor(
          edgeColorBlue,
          firstSegmentLocation,
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
          firstSegmentLocation,
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
          firstSegmentLocation,
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
          firstSegmentLocation,
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
    const expectedOutput = `plane001 = offsetPlane(XZ, offset = 5)`
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step(`Go through the command bar flow`, async () => {
      await toolbar.offsetPlaneButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'plane',
        currentArgValue: '',
        headerArguments: { Plane: '', Offset: '' },
        highlightedHeaderArg: 'plane',
        commandName: 'Offset plane',
      })
      await toolbar.selectDefaultPlane('Front plane')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'offset',
        currentArgValue: '5',
        headerArguments: { Plane: '1 plane', Offset: '' },
        highlightedHeaderArg: 'offset',
        commandName: 'Offset plane',
      })
      await cmdBar.progressCmdBar()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await editor.expectEditor.toContain(expectedOutput)
      await editor.expectState({
        diagnostics: [],
        activeLines: [expectedOutput],
        highlightedCode: '',
      })
    })

    await test.step('Delete offset plane via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Offset Plane',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
    })
  })

  const initialCmdBarStateHelix: CmdBarSerialised = {
    stage: 'arguments',
    currentArgKey: 'mode',
    currentArgValue: '',
    headerArguments: {
      Mode: '',
      AngleStart: '',
      Revolutions: '',
      Radius: '',
    },
    highlightedHeaderArg: 'mode',
    commandName: 'Helix',
  }

  test(`Helix point-and-click around sweepEdge with edit and delete flows`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
|> yLine(length = 100)
|> line(endAbsolute = [100, 0])
|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
|> close()
extrude001 = extrude(profile001, length = 100)`

    // One dumb hardcoded screen pixel value to click on the sweepEdge, can't think of another way?
    const testPoint = { x: 564, y: 364 }
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
      await cmdBar.expectState(initialCmdBarStateHelix)
      await cmdBar.selectOption({ name: 'Edge' }).click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
      await clickOnEdge()
      await cmdBar.progressCmdBar()
      await cmdBar.argumentInput.focus()
      await page.keyboard.insertText('20')
      await cmdBar.progressCmdBar()
      await page.keyboard.insertText('0')
      await cmdBar.progressCmdBar()
      await page.keyboard.insertText('1')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Mode: 'Edge',
          Edge: `1 sweepEdge`,
          AngleStart: '0',
          Revolutions: '20',
          Radius: '1',
        },
        commandName: 'Helix',
      })
      await cmdBar.clickOptionalArgument('ccw')
      await cmdBar.selectOption({ name: 'On' }).click()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Mode: 'Edge',
          Edge: `1 sweepEdge`,
          AngleStart: '0',
          Revolutions: '20',
          Radius: '1',
          CounterClockWise: '',
        },
        commandName: 'Helix',
      })
      await cmdBar.submit()
      await scene.settled(cmdBar)
    })

    await test.step(`Confirm code is added to the editor, scene has changed`, async () => {
      await toolbar.openPane('code')
      await editor.expectEditor.toContain(
        `
        helix001 = helix(
          axis = getOppositeEdge(seg01),
          revolutions = 20,
          angleStart = 0,
          radius = 1,
          ccw = true,
        )`,
        { shouldNormalise: true }
      )
      await toolbar.closePane('code')
    })

    await test.step(`Edit helix through the feature tree`, async () => {
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.dblclick()
      const initialInput = '1'
      const newInput = '5'
      await cmdBar.expectState({
        commandName: 'Helix',
        stage: 'arguments',
        currentArgKey: 'radius',
        currentArgValue: initialInput,
        headerArguments: {
          AngleStart: '0',
          Revolutions: '20',
          Radius: initialInput,
          CounterClockWise: '',
        },
        highlightedHeaderArg: 'radius',
      })
      await page.keyboard.insertText(newInput)
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
      await page.getByRole('button', { name: 'CounterClockWise' }).click()
      await cmdBar.expectState({
        commandName: 'Helix',
        stage: 'arguments',
        currentArgKey: 'CounterClockWise',
        currentArgValue: '',
        headerArguments: {
          AngleStart: '0',
          Revolutions: '20',
          Radius: newInput,
          CounterClockWise: '',
        },
        highlightedHeaderArg: 'CounterClockWise',
      })
      await cmdBar.selectOption({ name: 'Off' }).click()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          AngleStart: '0',
          Revolutions: '20',
          Radius: newInput,
        },
        commandName: 'Helix',
      })
      await cmdBar.submit()
      await toolbar.closePane('feature-tree')
      await toolbar.openPane('code')
      await editor.expectEditor.toContain(
        `
        helix001 = helix(
          axis = getOppositeEdge(seg01),
          revolutions = 20,
          angleStart = 0,
          radius = 5,
        )`,
        { shouldNormalise: true }
      )
      await toolbar.closePane('code')
    })

    await test.step('Delete helix via feature tree selection', async () => {
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation('Helix', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await editor.expectEditor.not.toContain('helix')
      await expect(
        await toolbar.getFeatureTreeOperation('Helix', 0)
      ).not.toBeVisible()
    })
  })

  test(`Loft point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const circleCode1 = `circle(center = [0, 0], radius = 30)`
    const circleCode2 = `circle(center = [0, 0], radius = 20)`
    const initialCode = `offset001 = 50
sketch001 = startSketchOn(XZ)
  |> ${circleCode1}
plane001 = offsetPlane(XZ, offset = offset001)
sketch002 = startSketchOn(plane001)
  |> ${circleCode2}
      `
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const loftDeclaration = 'loft001 = loft([sketch001, sketch002])'
    const editedLoftDeclaration =
      'loft001 = loft([sketch001, sketch002], vDegree = 3)'

    async function selectSketches() {
      const multiCursorKey = process.platform === 'linux' ? 'Control' : 'Meta'
      await editor.selectText(circleCode1)
      await page.keyboard.down(multiCursorKey)
      await page.getByText(circleCode2).click()
      await page.keyboard.up(multiCursorKey)
    }

    await test.step(`Go through the command bar flow without preselected sketches`, async () => {
      await toolbar.loftButton.click()
      await expect
        .poll(() => page.getByText('Please select one').count())
        .toBe(1)
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'sketches',
        currentArgValue: '',
        headerArguments: { Profiles: '' },
        highlightedHeaderArg: 'Profiles',
        commandName: 'Loft',
      })
      await selectSketches()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: { Profiles: '2 profiles' },
        commandName: 'Loft',
      })
      await cmdBar.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(loftDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [loftDeclaration],
        highlightedCode: '',
      })
    })

    await test.step('Go through the edit flow via feature tree', async () => {
      await toolbar.openPane('feature-tree')
      const op = await toolbar.getFeatureTreeOperation('Loft', 0)
      await op.dblclick()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {},
        commandName: 'Loft',
      })
      await cmdBar.clickOptionalArgument('vDegree')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'vDegree',
        currentArgValue: '',
        headerArguments: {
          VDegree: '',
        },
        highlightedHeaderArg: 'vDegree',
        commandName: 'Loft',
      })
      await page.keyboard.insertText('3')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          VDegree: '3',
        },
        commandName: 'Loft',
      })
      await cmdBar.submit()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(editedLoftDeclaration)
    })

    await test.step('Delete loft via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Loft', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain(editedLoftDeclaration)
    })
  })

  // Note: testing the helix case here for sweep as it's the only one we can't
  // test in src\lang\modifyAst\sweeps.test.ts
  test(`Sweep point-and-click helix`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const circleCode = `circle(sketch001, center = [0, -1], radius = .1)`
    const initialCode = `helix001 = helix(
  axis = X,
  radius = 1,
  length = 10,
  revolutions = 10,
  angleStart = 0,
  ccw = false,
)
sketch001 = startSketchOn(XZ)
profile001 = ${circleCode}`
    const sweepDeclaration = 'sweep001 = sweep(profile001, path = helix001)'
    const editedSweepDeclaration = `sweep001 = sweep(profile001, path = helix001, relativeTo = 'sketchPlane')`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step(`Add sweep through the command bar flow`, async () => {
      await toolbar.openPane('feature-tree')
      await toolbar.sweepButton.click()
      await cmdBar.expectState({
        commandName: 'Sweep',
        currentArgKey: 'sketches',
        currentArgValue: '',
        headerArguments: {
          Profiles: '',
          Path: '',
        },
        highlightedHeaderArg: 'Profiles',
        stage: 'arguments',
      })
      await editor.scrollToText(circleCode)
      await page.getByText(circleCode).click()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Sweep',
        currentArgKey: 'path',
        currentArgValue: '',
        headerArguments: {
          Profiles: '1 profile',
          Path: '',
        },
        highlightedHeaderArg: 'path',
        stage: 'arguments',
      })
      const helix = await toolbar.getFeatureTreeOperation('Helix', 0)
      await helix.click()
      await cmdBar.expectState({
        commandName: 'Sweep',
        currentArgKey: 'path',
        currentArgValue: '',
        headerArguments: {
          Profiles: '1 profile',
          Path: '',
        },
        highlightedHeaderArg: 'path',
        stage: 'arguments',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Sweep',
        headerArguments: {
          Profiles: '1 profile',
          Path: '1 helix',
        },
        stage: 'review',
      })
      await cmdBar.progressCmdBar(true)
      await editor.expectEditor.toContain(sweepDeclaration)
    })

    await test.step('Go through the edit flow via feature tree', async () => {
      await toolbar.openPane('feature-tree')
      const op = await toolbar.getFeatureTreeOperation('Sweep', 0)
      await op.dblclick()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {},
        commandName: 'Sweep',
      })
      await cmdBar.clickOptionalArgument('relativeTo')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'relativeTo',
        currentArgValue: '',
        headerArguments: {
          RelativeTo: '',
        },
        highlightedHeaderArg: 'relativeTo',
        commandName: 'Sweep',
      })
      await cmdBar.selectOption({ name: 'sketchPlane' }).click()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          RelativeTo: 'sketchPlane',
        },
        commandName: 'Sweep',
      })
      await cmdBar.submit()
      await editor.expectEditor.toContain(editedSweepDeclaration)
    })

    await test.step('Delete sweep via feature tree selection', async () => {
      const sweep = await toolbar.getFeatureTreeOperation('Sweep', 0)
      await sweep.click()
      await page.keyboard.press('Delete')
      await editor.expectEditor.not.toContain(editedSweepDeclaration)
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
    // TODO: find a way to not have hardcoded pixel values for sweepEdges
    const secondEdgeLocation = { x: 600, y: 383 }
    const [clickOnSecondEdge] = scene.makeMouseHelpers(
      secondEdgeLocation.x,
      secondEdgeLocation.y
    )

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
      await editor.selectText(
        'line(endAbsolute = [profileStartX(%), profileStartY(%)])'
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
      await clickOnSecondEdge()
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
        await editor.expectEditor.not.toContain(secondFilletDeclaration)
      })
    })
  })

  test(`Fillet point-and-click edit standalone expression`, async ({
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
fillet001 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])
`
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })
    await test.step('Edit fillet', async () => {
      await toolbar.openPane('feature-tree')
      await toolbar.closePane('code')
      const operationButton = await toolbar.getFeatureTreeOperation('Fillet', 0)
      await operationButton.dblclick({ button: 'left' })
      await cmdBar.expectState({
        commandName: 'Fillet',
        currentArgKey: 'radius',
        currentArgValue: '5',
        headerArguments: {
          Radius: '5',
        },
        highlightedHeaderArg: 'radius',
        stage: 'arguments',
      })
      await page.keyboard.insertText('20')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Radius: '20',
        },
        commandName: 'Fillet',
      })
      await cmdBar.progressCmdBar()
    })
    await test.step('Confirm changes', async () => {
      await toolbar.openPane('code')
      await toolbar.closePane('feature-tree')
      await editor.expectEditor.toContain('radius = 20')
    })
  })

  test(`Fillet point-and-click delete`, async ({
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
  |> line(end = [24, 0], tag = $seg02)
  |> line(end = [0, -12])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()
extrude001 = extrude(sketch001, length = -12)
  |> fillet(radius = 5, tags = [seg01]) // fillet01
  |> fillet(radius = 5, tags = [seg02]) // fillet02
fillet03 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])
fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg02)])
`
    const firstPipedFilletDeclaration = 'fillet(radius = 5, tags = [seg01])'
    const secondPipedFilletDeclaration = 'fillet(radius = 5, tags = [seg02])'
    const standaloneAssignedFilletDeclaration =
      'fillet03 = fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg01)])'
    const standaloneUnassignedFilletDeclaration =
      'fillet(extrude001, radius = 5, tags = [getOppositeEdge(seg02)])'

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    // Test
    await test.step('Delete fillet via feature tree selection', async () => {
      await test.step('Open Feature Tree Pane', async () => {
        await toolbar.openPane('feature-tree')
        await scene.settled(cmdBar)
      })

      await test.step('Delete piped fillet via feature tree selection', async () => {
        await test.step('Verify all fillets are present in the editor', async () => {
          await editor.expectEditor.toContain(firstPipedFilletDeclaration)
          await editor.expectEditor.toContain(secondPipedFilletDeclaration)
          await editor.expectEditor.toContain(
            standaloneAssignedFilletDeclaration
          )
          await editor.expectEditor.toContain(
            standaloneUnassignedFilletDeclaration
          )
        })
        await test.step('Delete piped fillet', async () => {
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Fillet',
            0
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled(cmdBar)
        })
        await test.step('Verify piped fillet is deleted but other fillets are not (in the editor)', async () => {
          await editor.expectEditor.not.toContain(firstPipedFilletDeclaration)
          await editor.expectEditor.toContain(secondPipedFilletDeclaration)
          await editor.expectEditor.toContain(
            standaloneAssignedFilletDeclaration
          )
          await editor.expectEditor.toContain(
            standaloneUnassignedFilletDeclaration
          )
        })
      })

      await test.step('Delete standalone assigned fillet via feature tree selection', async () => {
        await test.step('Delete standalone assigned fillet', async () => {
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Fillet',
            1
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled(cmdBar)
        })
        await test.step('Verify standalone assigned fillet is deleted but other two fillets are not (in the editor)', async () => {
          await editor.expectEditor.toContain(secondPipedFilletDeclaration)
          await editor.expectEditor.not.toContain(
            standaloneAssignedFilletDeclaration
          )
          await editor.expectEditor.toContain(
            standaloneUnassignedFilletDeclaration
          )
        })
      })

      await test.step('Delete standalone unassigned fillet via feature tree selection', async () => {
        await test.step('Delete standalone unassigned fillet', async () => {
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Fillet',
            1
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled(cmdBar)
        })
        await test.step('Verify standalone unassigned fillet is deleted but other fillet is not (in the editor)', async () => {
          await editor.expectEditor.toContain(secondPipedFilletDeclaration)
          await editor.expectEditor.not.toContain(
            standaloneUnassignedFilletDeclaration
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
    // TODO: find a way to select sweepEdges in a different way
    const edgeLocation = { x: 649, y: 283 }

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    // Test
    await test.step('Select edges and apply oversized fillet', async () => {
      await test.step(`Select the edge`, async () => {
        await toolbar.closePane('code')
        const [clickOnTheEdge] = scene.makeMouseHelpers(
          edgeLocation.x,
          edgeLocation.y
        )
        await clickOnTheEdge()
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

    // Colors
    const edgeColorWhite: [number, number, number] = [248, 248, 248]
    const edgeColorYellow: [number, number, number] = [251, 251, 80] // Mac:B=67 Ubuntu:B=12
    const chamferColor: [number, number, number] = [168, 168, 168]
    const backgroundColor: [number, number, number] = [30, 30, 30]
    const lowTolerance = 20
    const highTolerance = 75 // TODO: understand why I needed that for edgeColorYellow on macos (local)

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.closePane()
    })

    const [clickOnFirstEdge] = scene.makeMouseHelpers(
      firstEdgeLocation.x,
      firstEdgeLocation.y
    )
    const [clickOnSecondEdge] = scene.makeMouseHelpers(
      secondEdgeLocation.x,
      secondEdgeLocation.y
    )

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
      await editor.openPane()
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
      await editor.closePane()
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
      await editor.openPane()
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
      await editor.closePane()
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
      await editor.closePane()
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
      await toolbar.closeFeatureTreePane()
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
chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg02)])
`
    const firstPipedChamferDeclaration = 'chamfer(length = 5, tags = [seg01])'
    const secondPipedChamferDeclaration = 'chamfer(length = 5, tags = [seg02])'
    const standaloneAssignedChamferDeclaration =
      'chamfer03 = chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg01)])'
    const standaloneUnassignedChamferDeclaration =
      'chamfer(extrude001, length = 5, tags = [getOppositeEdge(seg02)])'

    // Locators
    const pipedChamferEdgeLocation = { x: 600, y: 193 }
    const standaloneChamferEdgeLocation = { x: 600, y: 383 }

    // Colors
    const edgeColorWhite: [number, number, number] = [248, 248, 248]
    const chamferColor: [number, number, number] = [168, 168, 168]
    const backgroundColor: [number, number, number] = [30, 30, 30]
    const lowTolerance = 20

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.closePane()
    })

    // Test
    await test.step('Delete chamfer via feature tree selection', async () => {
      await test.step('Open Feature Tree Pane', async () => {
        await toolbar.openPane('feature-tree')
        await scene.settled(cmdBar)
      })

      await test.step('Delete piped chamfer via feature tree selection', async () => {
        await test.step('Verify all chamfers are present in the editor', async () => {
          await editor.expectEditor.toContain(firstPipedChamferDeclaration)
          await editor.expectEditor.toContain(secondPipedChamferDeclaration)
          await editor.expectEditor.toContain(
            standaloneAssignedChamferDeclaration
          )
          await editor.expectEditor.toContain(
            standaloneUnassignedChamferDeclaration
          )
        })
        await test.step('Verify test chamfers are present in the scene', async () => {
          await editor.closePane()
          await toolbar.closeFeatureTreePane()
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
          await editor.closePane()
          await toolbar.openFeatureTreePane()
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Chamfer',
            0
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await toolbar.closeFeatureTreePane()
          await scene.settled(cmdBar)
        })
        await test.step('Verify piped chamfer is deleted but other chamfers are not (in the editor)', async () => {
          await editor.expectEditor.not.toContain(firstPipedChamferDeclaration)
          await editor.expectEditor.toContain(secondPipedChamferDeclaration)
          await editor.expectEditor.toContain(
            standaloneAssignedChamferDeclaration
          )
          await editor.expectEditor.toContain(
            standaloneUnassignedChamferDeclaration
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

      await test.step('Delete standalone assigned chamfer via feature tree selection', async () => {
        await test.step('Delete standalone assigned chamfer', async () => {
          await toolbar.openFeatureTreePane()
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Chamfer',
            1
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled(cmdBar)
        })
        await test.step('Verify standalone assigned chamfer is deleted but other two chamfers are not (in the editor)', async () => {
          await editor.expectEditor.toContain(secondPipedChamferDeclaration)
          await editor.expectEditor.not.toContain(
            standaloneAssignedChamferDeclaration
          )
          await editor.expectEditor.toContain(
            standaloneUnassignedChamferDeclaration
          )
        })
        await test.step('Verify standalone assigned chamfer is deleted but piped is not (in the scene)', async () => {
          await toolbar.closeFeatureTreePane()
          await editor.closePane()
          await scene.expectPixelColor(
            edgeColorWhite,
            standaloneChamferEdgeLocation,
            lowTolerance
          )
        })
      })

      await test.step('Delete standalone unassigned chamfer via feature tree selection', async () => {
        await test.step('Delete standalone unassigned chamfer', async () => {
          await toolbar.openFeatureTreePane()
          const operationButton = await toolbar.getFeatureTreeOperation(
            'Chamfer',
            1
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled(cmdBar)
        })
        await test.step('Verify standalone unassigned chamfer is deleted but piped chamfer is not (in the editor)', async () => {
          await editor.expectEditor.toContain(secondPipedChamferDeclaration)
          await editor.expectEditor.not.toContain(
            standaloneUnassignedChamferDeclaration
          )
        })
        await test.step('Verify standalone unassigned chamfer is deleted but piped is not (in the scene)', async () => {
          await editor.closePane()
          await toolbar.closeFeatureTreePane()
          await scene.expectPixelColor(
            edgeColorWhite,
            standaloneChamferEdgeLocation,
            lowTolerance
          )
        })
      })
    })
  })

  test(`Shell point-and-click`, async ({
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
    await scene.settled(cmdBar)

    // One dumb hardcoded screen pixel value
    // Any idea here how to select a cap without clicking in the scene?
    const testPoint = { x: 575, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const shellDeclaration =
      'shell001 = shell(extrude001, faces = END, thickness = 5)'
    const editedShellDeclaration =
      'shell001 = shell(extrude001, faces = END, thickness = 2)'

    await test.step(`Go through the command bar flow without preselected faces`, async () => {
      await toolbar.shellButton.click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'faces',
        currentArgValue: '',
        headerArguments: {
          Faces: '',
          Thickness: '',
        },
        highlightedHeaderArg: 'faces',
        commandName: 'Shell',
      })
      await clickOnCap()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'thickness',
        currentArgValue: '5',
        headerArguments: {
          Faces: '1 cap',
          Thickness: '',
        },
        highlightedHeaderArg: 'thickness',
        commandName: 'Shell',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Faces: '1 cap',
          Thickness: '5',
        },
        commandName: 'Shell',
      })
      await cmdBar.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(shellDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [shellDeclaration],
        highlightedCode: '',
      })
    })

    await test.step('Edit shell via feature tree selection works', async () => {
      await toolbar.openPane('feature-tree')
      const operationButton = await toolbar.getFeatureTreeOperation('Shell', 0)
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
      await cmdBar.submit()
      await scene.settled(cmdBar)
      await toolbar.closePane('feature-tree')
      await toolbar.openPane('code')
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
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain(shellDeclaration)
    })
  })

  test('Revolve point-and-click', async ({
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
  |> angledLine(angle = 0deg, length = 202.6, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 202.6, tag = $rectangleSegmentB001)
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
    await cmdBar.progressCmdBar()
    await page.getByText('Edge', { exact: true }).click()
    const lineCodeToSelection = `angledLine(angle = 0deg, length = 202.6, tag = $rectangleSegmentA001)`
    await editor.selectText(lineCodeToSelection)
    await cmdBar.progressCmdBar()
    await cmdBar.progressCmdBar()
    await cmdBar.progressCmdBar()

    const newCodeToFind = `revolve001 = revolve(sketch002, angle = 360deg, axis = rectangleSegmentA001)`
    await editor.expectEditor.toContain(newCodeToFind)

    // Edit flow
    const newAngle = '180deg'
    await toolbar.openPane('feature-tree')
    const operationButton = await toolbar.getFeatureTreeOperation('Revolve', 0)
    await operationButton.dblclick({ button: 'left' })
    await cmdBar.expectState({
      commandName: 'Revolve',
      currentArgKey: 'angle',
      currentArgValue: '360deg',
      headerArguments: {
        Angle: '360deg',
      },
      highlightedHeaderArg: 'angle',
      stage: 'arguments',
    })
    await page.keyboard.insertText(newAngle)
    await cmdBar.variableCheckbox.click()
    await expect(page.getByPlaceholder('Variable name')).toHaveValue('angle001')
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
      newCodeToFind.replace('angle = 360deg', 'angle = angle001')
    )
    expect(editor.expectEditor.toContain(newCodeToFind)).toBeTruthy()
  })

  test(`Appearance point-and-click`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)`
    const declaration = `appearance(extrude001, color = '#ff0000')`
    const editedDeclaration = `appearance(extrude001, color = '#00ff00')`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step(`Go through the Set Appearance flow`, async () => {
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Extrude',
        0
      )
      await operationButton.click({ button: 'right' })
      const menuButton = page.getByTestId('context-menu-set-appearance')
      await menuButton.click()
      await cmdBar.expectState({
        commandName: 'Appearance',
        currentArgKey: 'objects',
        currentArgValue: '',
        headerArguments: {
          Objects: '',
          Color: '',
        },
        highlightedHeaderArg: 'objects',
        stage: 'arguments',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Appearance',
        currentArgKey: 'color',
        currentArgValue: '',
        headerArguments: {
          Objects: '1 sweep',
          Color: '',
        },
        highlightedHeaderArg: 'color',
        stage: 'arguments',
      })
      await cmdBar.currentArgumentInput.fill('#ff0000') // uppercase doesn't work here
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Appearance',
        headerArguments: {
          Objects: '1 sweep',
          Color: '#ff0000',
        },
        stage: 'review',
      })
      await cmdBar.submit()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(declaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [declaration],
        highlightedCode: '',
      })
    })

    await test.step('Edit appearance via feature tree selection works', async () => {
      const op = await toolbar.getFeatureTreeOperation('Appearance', 0)
      await op.dblclick({ button: 'left' })
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'color',
        currentArgValue: '',
        headerArguments: {
          Color: '#ff0000',
        },
        highlightedHeaderArg: 'color',
        commandName: 'Appearance',
      })
      await cmdBar.currentArgumentInput.fill('#00ff00')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Color: '#00ff00',
        },
        commandName: 'Appearance',
      })
      await cmdBar.submit()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(editedDeclaration)
      await editor.expectState({
        diagnostics: [],
        activeLines: [editedDeclaration],
        highlightedCode: '',
      })
    })

    await test.step('Delete appearance via feature tree selection', async () => {
      await editor.closePane()
      const op = await toolbar.getFeatureTreeOperation('Appearance', 0)
      await op.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain(declaration)
      await editor.expectEditor.not.toContain(editedDeclaration)
    })
  })
})
