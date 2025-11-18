import type { Page } from '@playwright/test'

import { bracket } from '@e2e/playwright/fixtures/bracket'
import type { CmdBarSerialised } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { expect, test } from '@e2e/playwright/zoo-test'
import { KCL_DEFAULT_INSTANCES, KCL_DEFAULT_LENGTH } from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

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
      await cmdBar.clickHeaderArgument('length')
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
      await cmdBar.clickHeaderArgument('length')
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
      await cmdBar.clickHeaderArgument('length')
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
      await cmdBar.clickOptionalArgument('length')
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
      await cmdBar.clickHeaderArgument('length')
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
      await toolbar.closePane(DefaultLayoutPaneID.Code)
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
    toolbar,
    cmdBar,
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
    const edgeColorWhite: [number, number, number] = [230, 230, 230]
    const edgeColorBlue: [number, number, number] = [23, 10, 247]
    const tolerance = 50
    const timeout = 150

    // Setup
    await test.step(`Initial test setup`, async () => {
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Select and deselect a single sketch segment', async () => {
      await test.step('Get into sketch mode', async () => {
        await editor.closePane()
        await page.waitForTimeout(timeout)
        await toolbar.startSketchBtn.click()
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
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: { Plane: '1 plane', Offset: '5' },
        commandName: 'Offset plane',
      })
      await cmdBar.submit()
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
      await toolbar.closePane(DefaultLayoutPaneID.Code)
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
      await toolbar.openPane(DefaultLayoutPaneID.Code)
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
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step(`Edit helix through the feature tree`, async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
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
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step('Delete helix via feature tree selection', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
    const editedSweepDeclaration = `sweep001 = sweep(profile001, path = helix001, relativeTo = sweep::SKETCH_PLANE)`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step(`Add sweep through the command bar flow`, async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await cmdBar.selectOption({ name: 'Sketch Plane' }).click()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          RelativeTo: 'SKETCH_PLANE',
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
    const firstFilletDeclaration = `fillet001 = fillet(extrude001, tags=getCommonEdge(faces=[seg01,capEnd001]), radius=5)`
    const secondFilletDeclaration = `fillet002 = fillet(extrude001, tags=getCommonEdge(faces=[seg01,capStart001]), radius=5)`

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
    })

    // Test 1.1: Edit fillet (segment type)
    async function editFillet(
      featureTreeIndex: number,
      oldValue: string,
      newValue: string
    ) {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
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
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
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
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
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
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
    const filletExpression = `fillet001 = fillet(extrude001, tags = getCommonEdge(faces = [seg01, seg02]), radius = 1000)`

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
        await toolbar.closePane(DefaultLayoutPaneID.Code)
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
    const firstChamferDeclaration = `chamfer001 = chamfer(extrude001, tags=getCommonEdge(faces=[seg01,capEnd001]), length=5)`
    const secondChamferDeclaration = `chamfer002 = chamfer(extrude001, tags=getCommonEdge(faces=[seg01,capStart001]), length=5)`

    // Locators
    const firstEdgeLocation = { x: 600, y: 193 }
    const secondEdgeLocation = { x: 600, y: 383 }

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
      await clickOnFirstEdge()
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
      await editor.closePane()
    })

    // Test 1.1: Edit sweep
    async function editChamfer(
      featureTreeIndex: number,
      oldValue: string,
      newValue: string
    ) {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
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
      await clickOnSecondEdge()
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
      await editor.closePane()
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
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      await page.waitForTimeout(500)
    })
    await test.step('Delete chamfer via feature tree selection', async () => {
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Chamfer',
        1
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain(secondChamferDeclaration, {
        shouldNormalise: true,
      })
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
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
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
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
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
  |> circle(center = [-11.34, 10.0], radius = 8.69)`
    const newCodeToFind = `revolve001 = revolve(sketch002, angle = 360deg, axis = rectangleSegmentA001)`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await test.step('Add revolve feature via point-and-click', async () => {
      // select line of code
      const codeToSelection = `center = [-11.34, 10.0]`
      // revolve
      await editor.scrollToText(codeToSelection)
      await page.getByText(codeToSelection).click()
      await toolbar.revolveButton.click()
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'sketches',
        currentArgValue: '',
        headerArguments: {
          Profiles: '',
          AxisOrEdge: '',
          Angle: '',
        },
        highlightedHeaderArg: 'Profiles',
        stage: 'arguments',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'axisOrEdge',
        currentArgValue: '',
        headerArguments: {
          Profiles: '1 profile',
          AxisOrEdge: '',
          Angle: '',
        },
        highlightedHeaderArg: 'axisOrEdge',
        stage: 'arguments',
      })
      await cmdBar.selectOption({ name: 'Edge' }).click()
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'edge',
        currentArgValue: '',
        headerArguments: {
          Profiles: '1 profile',
          Angle: '',
          AxisOrEdge: 'Edge',
          Edge: '',
        },
        highlightedHeaderArg: 'edge',
        stage: 'arguments',
      })
      const lineCodeToSelection = `angledLine(angle = 0deg, length = 202.6, tag = $rectangleSegmentA001)`
      await editor.selectText(lineCodeToSelection)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'angle',
        currentArgValue: '360deg',
        headerArguments: {
          Profiles: '1 profile',
          Angle: '',
          AxisOrEdge: 'Edge',
          Edge: '1 segment',
        },
        highlightedHeaderArg: 'angle',
        stage: 'arguments',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Revolve',
        headerArguments: {
          Profiles: '1 profile',
          Angle: '360deg',
          AxisOrEdge: 'Edge',
          Edge: '1 segment',
        },
        stage: 'review',
      })
      await cmdBar.submit()

      await editor.expectEditor.toContain(newCodeToFind)
    })

    await test.step('Edit revolve feature via feature tree selection', async () => {
      const newAngle = '180deg'
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const operationButton = await toolbar.getFeatureTreeOperation(
        'Revolve',
        0
      )
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
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await editor.expectEditor.toContain('angle001 = ' + newAngle)
      await editor.expectEditor.toContain(
        newCodeToFind.replace('angle = 360deg', 'angle = angle001')
      )
    })
  })

  test(`Translate point-and-click with segment-to-body coercion`, async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch = startSketchOn(XY)
profile = startProfile(sketch, at = [-5, -10])
  |> xLine(length = 10)
  |> yLine(length = 20)
  |> xLine(length = -10)
  |> close()
box = extrude(profile, length = 30)`
    const expectedTranslateCode = `translate(box, x = 50)`
    const segmentToSelect = `yLine(length = 20)`

    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Select an edge first (before opening translate)', async () => {
      await editor.selectText(segmentToSelect)
      await expect(toolbar.selectionStatus).toContainText('1 segment')
    })

    await test.step('Open translate via context menu and verify coercion', async () => {
      await toolbar.translateButton.click()

      // When translate opens with a segment selected, it should coerce to the parent body
      // The segment belongs to the 'profile' path, which is extruded into 'box'
      // So the selection should coerce from segment to path (body)
      await cmdBar.expectState({
        commandName: 'Translate',
        currentArgKey: 'objects',
        currentArgValue: '',
        headerArguments: {
          Objects: '',
        },
        highlightedHeaderArg: 'objects',
        stage: 'arguments',
      })

      await expect(page.getByText('1 path selected')).toBeVisible()
      await expect(toolbar.selectionStatus).toContainText('1 path')
    })

    await test.step('Complete command flow', async () => {
      await test.step('Progress to review since object is already selected', async () => {
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 path',
          },
          commandName: 'Translate',
        })
      })

      await test.step('Add x translation', async () => {
        await cmdBar.clickOptionalArgument('x')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'x',
          currentArgValue: '0',
          headerArguments: {
            Objects: '1 path',
            X: '',
          },
          highlightedHeaderArg: 'x',
          commandName: 'Translate',
        })
        await page.keyboard.insertText('50')
        await cmdBar.progressCmdBar()
      })

      await test.step('Review and submit', async () => {
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 path',
            X: '50',
          },
          commandName: 'Translate',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
      })
    })

    await test.step('Verify code was added correctly', async () => {
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(expectedTranslateCode)
      await editor.expectState({
        diagnostics: [],
        activeLines: [expectedTranslateCode],
        highlightedCode: '',
      })
    })
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
    const declaration = `appearance(extrude001, color = "#ff0000")`
    const editedDeclaration = `appearance(extrude001, color = "#00ff00")`
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

  test('Pattern Circular 3D point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 2)
solid001 = extrude(sketch001, length = 5)`
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Add Pattern Circular 3D to the scene', async () => {
      await test.step('Open Pattern Circular 3D command from toolbar', async () => {
        await toolbar.patternCircularButton.click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Circular 3D',
          currentArgKey: 'solids',
          currentArgValue: '',
          headerArguments: {
            Solids: '',
            Instances: '',
            Axis: '',
            Center: '',
          },
          highlightedHeaderArg: 'solids',
        })
      })

      await test.step('Select solid and configure basic parameters', async () => {
        await test.step('Select solid', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'solids',
            currentArgValue: '',
            headerArguments: {
              Solids: '',
              Instances: '',
              Axis: '',
              Center: '',
            },
            highlightedHeaderArg: 'solids',
          })
          await editor.selectText('extrude(sketch001, length = 5)')
        })

        await test.step('Configure instances', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'instances',
            currentArgValue: KCL_DEFAULT_INSTANCES,
            headerArguments: {
              Solids: '1 sweep',
              Instances: '',
              Axis: '',
              Center: '',
            },
            highlightedHeaderArg: 'instances',
          })
          // Update instances from DEFAULT to 8
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('8')
        })

        await test.step('Configure axis', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'axis',
            currentArgValue: '',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: '',
              Center: '',
            },
            highlightedHeaderArg: 'axis',
          })
          // Select Y-axis and auto-progress
          await cmdBar.selectOption({ name: 'Y-axis' }).click()
        })

        await test.step('Configure center', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'center',
            currentArgValue: '[0, 0, 0]',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '',
            },
            highlightedHeaderArg: 'center',
          })
          // Update center from [0, 0, 0] to [5, 0, 0]
          await page.getByTestId('vector3d-x-input').fill('5')
        })

        await test.step('Review basic parameters', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
            },
          })
        })
      })

      await test.step('Configure optional parameters', async () => {
        await test.step('Configure arc degrees', async () => {
          await cmdBar.clickOptionalArgument('arcDegrees')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'arcDegrees',
            currentArgValue: '360deg',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
              ArcDegrees: '',
            },
            highlightedHeaderArg: 'arcDegrees',
          })
          // Update arc degrees from 360deg to 180
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('180')
          await cmdBar.progressCmdBar()
          // Review changes to arc degrees
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
              ArcDegrees: '180',
            },
          })
        })

        await test.step('Configure rotate duplicates', async () => {
          await cmdBar.clickOptionalArgument('rotateDuplicates')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'rotateDuplicates',
            currentArgValue: '',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
            },
            highlightedHeaderArg: 'rotateDuplicates',
          })
          // Select On option and auto-progress
          await cmdBar.selectOption({ name: 'On' }).click()
          // Review changes to rotate duplicates
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '', // True value shows as empty string in header
            },
          })
        })

        await test.step('Configure use original', async () => {
          await cmdBar.clickOptionalArgument('useOriginal')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'useOriginal',
            currentArgValue: '',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              UseOriginal: '',
            },
            highlightedHeaderArg: 'useOriginal',
          })
          // Select Off option and auto-progress
          await cmdBar.selectOption({ name: 'Off' }).click()
          // Review changes to use original
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('patternCircular3d(')
        await editor.expectEditor.toContain('instances = 8')
        await editor.expectEditor.toContain('axis = Y')
        await editor.expectEditor.toContain('center = [5, 0, 0]')
        await editor.expectEditor.toContain('arcDegrees = 180')
        await editor.expectEditor.toContain('rotateDuplicates = true')
        await editor.expectEditor.toContain('useOriginal = false')
      })
    })

    await test.step('Edit Pattern Circular 3D', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const patternOperation = await toolbar.getFeatureTreeOperation(
          'Circular Pattern',
          0
        )
        await patternOperation.dblclick()
        // Should open the command bar in edit mode
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Circular 3D',
          currentArgKey: 'center',
          currentArgValue: '[5, 0, 0]',
          headerArguments: {
            Instances: '8',
            Axis: 'Y',
            Center: '[5, 0, 0]',
            ArcDegrees: '180',
            RotateDuplicates: '',
            // UseOriginal with False value appears as a button in UI, not in header
          },
          highlightedHeaderArg: 'center',
        })
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit center', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'center',
            currentArgValue: '[5, 0, 0]',
            headerArguments: {
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 0, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
            highlightedHeaderArg: 'center',
          })
          // Update center from [5, 0, 0] to [5, 3+4, 0]
          await page.getByTestId('vector3d-y-input').fill('3+4')
          await cmdBar.progressCmdBar()
          // Review changes to center
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 7, 0]', // [5, 3+4, 0]
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
          })
        })

        await test.step('Edit instances', async () => {
          await page.getByRole('button', { name: 'Instances' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'instances',
            currentArgValue: '8',
            headerArguments: {
              Instances: '8',
              Axis: 'Y',
              Center: '[5, 7, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
            highlightedHeaderArg: 'instances',
          })
          // Update instances from 8 to 12
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('12')
          await cmdBar.progressCmdBar()
          // Review changes to instances
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Instances: '12',
              Axis: 'Y',
              Center: '[5, 7, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
          })
        })

        await test.step('Edit axis', async () => {
          await page.getByRole('button', { name: 'Axis' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'axis',
            currentArgValue: '',
            headerArguments: {
              Instances: '12',
              Axis: 'Y',
              Center: '[5, 7, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
            highlightedHeaderArg: 'axis',
          })
          // Update axis from Y-axis to Z-axis and auto-progress
          await cmdBar.selectOption({ name: 'Z-axis' }).click()
          // Review changes to axis
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Instances: '12',
              Axis: 'Z',
              Center: '[5, 7, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
          })
        })

        await test.step('Edit arc degrees', async () => {
          await page.getByRole('button', { name: 'ArcDegrees' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'arcDegrees',
            currentArgValue: '180',
            headerArguments: {
              Instances: '12',
              Axis: 'Z',
              Center: '[5, 7, 0]',
              ArcDegrees: '180',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
            highlightedHeaderArg: 'arcDegrees',
          })
          // Update arc degrees from 180 to 270
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('270')
          await cmdBar.progressCmdBar()
          // Review changes to arc degrees
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Instances: '12',
              Axis: 'Z',
              Center: '[5, 7, 0]',
              ArcDegrees: '270',
              RotateDuplicates: '',
              // UseOriginal with False value appears as a button in UI, not in header
            },
          })
        })

        await test.step('Edit rotate duplicates', async () => {
          await page.getByRole('button', { name: 'RotateDuplicates' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'rotateDuplicates',
            currentArgValue: '',
            headerArguments: {
              Instances: '12',
              Axis: 'Z',
              Center: '[5, 7, 0]',
              ArcDegrees: '270',
              RotateDuplicates: '', // True and False value appears at this stage
              // UseOriginal with False value appears as a button in UI, not in header
            },
            highlightedHeaderArg: 'rotateDuplicates',
          })
          // Update rotate duplicates from On to Off
          await cmdBar.selectOption({ name: 'Off' }).click()
          // Review changes to rotate duplicates
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Instances: '12',
              Axis: 'Z',
              Center: '[5, 7, 0]',
              ArcDegrees: '270',
              // RotateDuplicates with False value appears as a button in UI, not in header
              // UseOriginal with False value appears as a button in UI, not in header
            },
          })
        })

        await test.step('Edit use original', async () => {
          await page.getByRole('button', { name: 'UseOriginal' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Circular 3D',
            currentArgKey: 'useOriginal',
            currentArgValue: '',
            headerArguments: {
              Instances: '12',
              Axis: 'Z',
              Center: '[5, 7, 0]',
              ArcDegrees: '270',
              // RotateDuplicates with False value appears as a button in UI, not in header
              UseOriginal: '', // True and False value appears at this stage
            },
            highlightedHeaderArg: 'useOriginal',
          })
          // Update use original from Off to On
          await cmdBar.selectOption({ name: 'On' }).click()
          // Review changes to use original
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Circular 3D',
            headerArguments: {
              Instances: '12',
              Axis: 'Z',
              Center: '[5, 7, 0]',
              ArcDegrees: '270',
              // RotateDuplicates with False value appears as a button in UI, not in header
              UseOriginal: '',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('patternCircular3d(')
        await editor.expectEditor.toContain('instances = 12')
        await editor.expectEditor.toContain('axis = Z')
        await editor.expectEditor.toContain('center = [5, 3 + 4, 0]')
        await editor.expectEditor.toContain('arcDegrees = 270')
        await editor.expectEditor.toContain('rotateDuplicates = false')
        await editor.expectEditor.toContain('useOriginal = true')
      })
    })

    await test.step('Delete Pattern Circular 3D', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const patternOperation = await toolbar.getFeatureTreeOperation(
        'Circular Pattern',
        0
      )
      // Delete the pattern operation
      await patternOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('patternCircular3d(')
    })
  })

  test('Pattern Linear 3D point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], radius = 2)
solid001 = extrude(sketch001, length = 5)`
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      // await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step('Add Pattern Linear 3D to the scene', async () => {
      await test.step('Open Pattern Linear 3D command from toolbar', async () => {
        await page
          .getByRole('button', { name: 'caret down pattern: open menu' })
          .click()
        await expect(
          page.getByTestId('dropdown-pattern-linear-3d')
        ).toBeVisible()
        await page.getByTestId('dropdown-pattern-linear-3d').click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Linear 3D',
          currentArgKey: 'solids',
          currentArgValue: '',
          headerArguments: {
            Solids: '',
            Instances: '',
            Distance: '',
            Axis: '',
          },
          highlightedHeaderArg: 'solids',
        })
      })

      await test.step('Select solid and configure parameters', async () => {
        await test.step('Select solid', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'solids',
            currentArgValue: '',
            headerArguments: {
              Solids: '',
              Instances: '',
              Distance: '',
              Axis: '',
            },
            highlightedHeaderArg: 'solids',
          })
          await editor.selectText('extrude(sketch001, length = 5)')
        })

        await test.step('Configure instances', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'instances',
            currentArgValue: KCL_DEFAULT_INSTANCES,
            headerArguments: {
              Solids: '1 sweep',
              Instances: '',
              Distance: '',
              Axis: '',
            },
            highlightedHeaderArg: 'instances',
          })
          // Update instances from DEFAULT to 6
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('6')
        })

        await test.step('Configure distance', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'distance',
            currentArgValue: KCL_DEFAULT_LENGTH,
            headerArguments: {
              Solids: '1 sweep',
              Instances: '6',
              Distance: '',
              Axis: '',
            },
            highlightedHeaderArg: 'distance',
          })
          // Update distance from KCL_DEFAULT_LENGTH to 8
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('8')
        })

        await test.step('Configure axis', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'axis',
            currentArgValue: '',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '6',
              Distance: '8',
              Axis: '',
            },
            highlightedHeaderArg: 'axis',
          })
          // Select Y-axis and auto-progress
          await cmdBar.selectOption({ name: 'Y-axis' }).click()
        })

        await test.step('Configure use original', async () => {
          await cmdBar.clickOptionalArgument('useOriginal')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'useOriginal',
            currentArgValue: '',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '6',
              Distance: '8',
              Axis: 'Y',
              UseOriginal: '',
            },
            highlightedHeaderArg: 'useOriginal',
          })
          // Select On option and auto-progress
          await cmdBar.selectOption({ name: 'On' }).click()
          // Review changes to use original
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Linear 3D',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '6',
              Distance: '8',
              Axis: 'Y',
              UseOriginal: '', // True value shows as empty string in header
            },
          })
        })

        await test.step('Review basic parameters', async () => {
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Linear 3D',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '6',
              Distance: '8',
              Axis: 'Y',
              UseOriginal: '',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('patternLinear3d(')
        await editor.expectEditor.toContain('instances = 6')
        await editor.expectEditor.toContain('distance = 8')
        await editor.expectEditor.toContain('axis = Y')
        await editor.expectEditor.toContain('useOriginal = true')
      })
    })

    await test.step('Edit Pattern Linear 3D', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const patternOperation = await toolbar.getFeatureTreeOperation(
          'Linear Pattern',
          0
        )
        await patternOperation.dblclick()
        // Should open the command bar in edit mode
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Linear 3D',
          currentArgKey: 'axis',
          currentArgValue: '',
          headerArguments: {
            Instances: '6',
            Distance: '8',
            Axis: 'Y',
            UseOriginal: '',
          },
          highlightedHeaderArg: 'axis',
        })
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit axis parameter', async () => {
          // Select Z-axis and auto-progress
          await cmdBar.selectOption({ name: 'Z-axis' }).click()
          // Review changes to axis
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Linear 3D',
            headerArguments: {
              Instances: '6',
              Distance: '8',
              Axis: 'Z',
              UseOriginal: '',
            },
          })
        })

        await test.step('Edit instances parameter', async () => {
          await page.getByRole('button', { name: 'Instances' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'instances',
            currentArgValue: '6',
            headerArguments: {
              Instances: '6',
              Distance: '8',
              Axis: 'Z',
              UseOriginal: '',
            },
            highlightedHeaderArg: 'instances',
          })
          // Update instances from 6 to 4
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('4')
          await cmdBar.progressCmdBar()
          // Review changes to instances
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Linear 3D',
            headerArguments: {
              Instances: '4',
              Distance: '8',
              Axis: 'Z',
              UseOriginal: '',
            },
          })
        })

        await test.step('Edit distance parameter', async () => {
          await page.getByRole('button', { name: 'Distance' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'distance',
            currentArgValue: '8',
            headerArguments: {
              Instances: '4',
              Distance: '8',
              Axis: 'Z',
              UseOriginal: '',
            },
            highlightedHeaderArg: 'distance',
          })
          // Update distance from 8 to 12
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('12')
          await cmdBar.progressCmdBar()
          // Review changes to distance
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Linear 3D',
            headerArguments: {
              Instances: '4',
              Distance: '12',
              Axis: 'Z',
              UseOriginal: '',
            },
          })
        })

        await test.step('Edit use original parameter', async () => {
          await page.getByRole('button', { name: 'UseOriginal' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'Pattern Linear 3D',
            currentArgKey: 'useOriginal',
            currentArgValue: '',
            headerArguments: {
              Instances: '4',
              Distance: '12',
              Axis: 'Z',
              UseOriginal: '',
            },
            highlightedHeaderArg: 'useOriginal',
          })
          // Update use original from On to Off
          await cmdBar.selectOption({ name: 'Off' }).click()
          // Review changes to use original
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'Pattern Linear 3D',
            headerArguments: {
              Instances: '4',
              Distance: '12',
              Axis: 'Z',
              // UseOriginal with False value appears as a button in UI, not in header
            },
          })
        })
      })

      await test.step('Submit and verify edited parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('patternLinear3d(')
        await editor.expectEditor.toContain('instances = 4')
        await editor.expectEditor.toContain('distance = 12')
        await editor.expectEditor.toContain('axis = Z')
        await editor.expectEditor.toContain('useOriginal = false')
      })
    })

    await test.step('Delete Pattern Linear 3D', async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)

      const patternOperation = await toolbar.getFeatureTreeOperation(
        'Linear Pattern',
        0
      )
      await patternOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')

      await scene.settled(cmdBar)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await editor.expectEditor.not.toContain('patternLinear3d(')
    })
  })

  test('GDT Flatness from command bar', async ({
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
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      // Close panes to ensure toolbar buttons are visible
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    // Adjusted coordinates to center screen for clicking on cap
    const testPoint = { x: 500, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    await test.step('Add GDT Flatness to the scene', async () => {
      await test.step('Open GDT Flatness command from toolbar', async () => {
        await toolbar.gdtFlatnessButton.click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'GDT Flatness',
          currentArgKey: 'faces',
          currentArgValue: '',
          headerArguments: {
            Faces: '',
            Tolerance: '',
          },
          highlightedHeaderArg: 'faces',
        })
      })

      await test.step('Select face and configure basic parameters', async () => {
        await test.step('Select face', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'faces',
            currentArgValue: '',
            headerArguments: {
              Faces: '',
              Tolerance: '',
            },
            highlightedHeaderArg: 'faces',
          })
          await clickOnCap()
        })

        await test.step('Configure tolerance', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'tolerance',
            currentArgValue: '0.1mm',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '',
            },
            highlightedHeaderArg: 'tolerance',
          })
          // Set tolerance to 0.1mm
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.1mm')
        })

        await test.step('Review basic parameters', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
            },
          })
        })
      })

      await test.step('Configure optional parameters', async () => {
        await test.step('Configure precision', async () => {
          await cmdBar.clickOptionalArgument('precision')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'precision',
            currentArgValue: '3',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '',
            },
            highlightedHeaderArg: 'precision',
          })
          // Update precision from 3 to 5
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('5')
          await cmdBar.progressCmdBar()
          // Review changes to precision
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
            },
          })
        })

        await test.step('Configure frame position', async () => {
          await cmdBar.clickOptionalArgument('framePosition')

          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'framePosition',
            currentArgValue: '[0, 0]',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '',
            },
            highlightedHeaderArg: 'framePosition',
          })
          // Update frame position from [0, 0] to [10, 10]
          await page.getByTestId('vector2d-x-input').fill('10')
          await page.getByTestId('vector2d-y-input').fill('10')
          await cmdBar.progressCmdBar()
          // Review changes to frame position
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
            },
          })
        })

        await test.step('Configure frame plane', async () => {
          await cmdBar.clickOptionalArgument('framePlane')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'framePlane',
            currentArgValue: '',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: '',
            },
            highlightedHeaderArg: 'framePlane',
          })
          // Select XY plane and auto-progress
          await cmdBar.selectOption({ name: 'XY' }).click()
          // Review changes to frame plane
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
            },
          })
        })

        await test.step('Configure font point size', async () => {
          await cmdBar.clickOptionalArgument('fontPointSize')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'fontPointSize',
            currentArgValue: '36',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '',
            },
            highlightedHeaderArg: 'fontPointSize',
          })
          // Update font point size from 36 to 48
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('48')
          await cmdBar.progressCmdBar()
          // Review changes to font point size
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
            },
          })
        })

        await test.step('Configure font scale', async () => {
          await cmdBar.clickOptionalArgument('fontScale')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'fontScale',
            currentArgValue: '1.0',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '',
            },
            highlightedHeaderArg: 'fontScale',
          })
          // Update font scale from 1 to 1.5
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('1.5')
          await cmdBar.progressCmdBar()
          // Review changes to font scale
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 cap',
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('experimentalFeatures = allow')
        await editor.expectEditor.toContain('gdt::flatness(')
        await editor.expectEditor.toContain('faces = [capEnd001]')
        await editor.expectEditor.toContain('tolerance = 0.1mm')
        await editor.expectEditor.toContain('precision = 5')
        await editor.expectEditor.toContain('framePosition = [10, 10]')
        await editor.expectEditor.toContain('framePlane = XY')
        await editor.expectEditor.toContain('fontPointSize = 48')
        await editor.expectEditor.toContain('fontScale = 1.5')
      })
    })

    await test.step('Edit GDT Flatness', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const gdtOperation = await toolbar.getFeatureTreeOperation(
          'Flatness',
          0
        )
        await gdtOperation.dblclick()
        // Should open the command bar in edit mode
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'GDT Flatness',
          currentArgKey: 'tolerance',
          currentArgValue: '0.1mm',
          headerArguments: {
            Tolerance: '0.1mm',
            Precision: '5',
            FramePosition: '[10, 10]',
            FramePlane: 'XY',
            FontPointSize: '48',
            FontScale: '1.5',
          },
          highlightedHeaderArg: 'tolerance',
        })
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit tolerance', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'tolerance',
            currentArgValue: '0.1mm',
            headerArguments: {
              Tolerance: '0.1mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
            highlightedHeaderArg: 'tolerance',
          })
          // Update tolerance from 0.1mm to 0.2mm
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.2mm')
          await cmdBar.progressCmdBar()
          // Review changes to tolerance
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
          })
        })

        await test.step('Edit precision', async () => {
          await page.getByRole('button', { name: 'Precision' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'precision',
            currentArgValue: '5',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
            highlightedHeaderArg: 'precision',
          })
          // Update precision from 5 to 3
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('3')
          await cmdBar.progressCmdBar()
          // Review changes to precision
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
          })
        })

        await test.step('Edit frame position', async () => {
          await page.getByRole('button', { name: 'FramePosition' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'framePosition',
            currentArgValue: '[10, 10]',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
            highlightedHeaderArg: 'framePosition',
          })
          // Update frame position from [10, 10] to [20, 30]
          await page.getByTestId('vector2d-x-input').fill('20')
          await page.getByTestId('vector2d-y-input').fill('30')
          await cmdBar.progressCmdBar()
          // Review changes to frame position
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
          })
        })

        await test.step('Edit frame plane', async () => {
          await page.getByRole('button', { name: 'FramePlane' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'framePlane',
            currentArgValue: '',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XY',
              FontPointSize: '48',
              FontScale: '1.5',
            },
            highlightedHeaderArg: 'framePlane',
          })
          // Update frame plane from XY to XZ
          await cmdBar.selectOption({ name: 'XZ' }).click()
          // Review changes to frame plane
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontPointSize: '48',
              FontScale: '1.5',
            },
          })
        })

        await test.step('Edit font point size', async () => {
          await page.getByRole('button', { name: 'FontPointSize' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'fontPointSize',
            currentArgValue: '48',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontPointSize: '48',
              FontScale: '1.5',
            },
            highlightedHeaderArg: 'fontPointSize',
          })
          // Update font point size from 48 to 24
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('24')
          await cmdBar.progressCmdBar()
          // Review changes to font point size
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontPointSize: '24',
              FontScale: '1.5',
            },
          })
        })

        await test.step('Edit font scale', async () => {
          await page.getByRole('button', { name: 'FontScale' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'fontScale',
            currentArgValue: '1.5',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontPointSize: '24',
              FontScale: '1.5',
            },
            highlightedHeaderArg: 'fontScale',
          })
          // Update font scale from 1.5 to 2.0
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('2.0')
          await cmdBar.progressCmdBar()
          // Review changes to font scale
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2mm',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontPointSize: '24',
              FontScale: '2',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain('gdt::flatness(')
        await editor.expectEditor.toContain('faces = [capEnd001]')
        await editor.expectEditor.toContain('tolerance = 0.2mm')
        await editor.expectEditor.toContain('precision = 3')
        await editor.expectEditor.toContain('framePosition = [20, 30]')
        await editor.expectEditor.toContain('framePlane = XZ')
        await editor.expectEditor.toContain('fontPointSize = 24')
        await editor.expectEditor.toContain('fontScale = 2')
      })
    })

    await test.step('Delete GDT Flatness', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const gdtOperation = await toolbar.getFeatureTreeOperation('Flatness', 0)
      // Delete the GDT operation
      await gdtOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('gdt::flatness(')
    })
  })

  test('Hole point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-5, -5])
  |> angledLine(angle = 0deg, length = 10, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 10)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10)`
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      // Close panes to ensure toolbar buttons are visible
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    await test.step('Add the hole through the command flow', async () => {
      await toolbar.holeButton.click()
      const testPoint = { x: 600, y: 250 }
      const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'face',
        currentArgValue: '',
        commandName: 'Hole',
        headerArguments: {
          Face: '',
          CutAt: '',
          HoleBody: '',
          HoleType: '',
          HoleBottom: '',
        },
        highlightedHeaderArg: 'face',
      })
      await clickOnCap()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'cutAt',
        currentArgValue: '[0, 0]',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 cap',
          CutAt: '',
          HoleBody: '',
          HoleType: '',
          HoleBottom: '',
        },
        highlightedHeaderArg: 'cutAt',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'holeBody',
        currentArgValue: '',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 cap',
          CutAt: '[0, 0]',
          HoleBody: '',
          HoleType: '',
          HoleBottom: '',
        },
        highlightedHeaderArg: 'holeBody',
      })
      await cmdBar.selectOption({ name: 'Blind' }).click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'blindDepth',
        currentArgValue: '5',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 cap',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '',
          BlindDiameter: '',
          HoleType: '',
          HoleBottom: '',
        },
        highlightedHeaderArg: 'blindDepth',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'blindDiameter',
        currentArgValue: '1',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 cap',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '5',
          BlindDiameter: '',
          HoleType: '',
          HoleBottom: '',
        },
        highlightedHeaderArg: 'blindDiameter',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'holeType',
        currentArgValue: '',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 cap',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '5',
          BlindDiameter: '1',
          HoleType: '',
          HoleBottom: '',
        },
        highlightedHeaderArg: 'holeType',
      })
      await cmdBar.selectOption({ name: 'Simple' }).click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'holeBottom',
        currentArgValue: '',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 cap',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '5',
          BlindDiameter: '1',
          HoleType: 'simple',
          HoleBottom: '',
        },
        highlightedHeaderArg: 'holeBottom',
      })
      await cmdBar.selectOption({ name: 'Flat' }).click()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 cap',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '5',
          BlindDiameter: '1',
          HoleType: 'simple',
          HoleBottom: 'flat',
        },
      })
      await cmdBar.submit()
    })

    await test.step('Expect hole call added to the editor', async () => {
      await scene.settled(cmdBar)
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(
        `@settings(experimentalFeatures = allow)`
      )
      await editor.expectEditor.toContain(
        `hole001 = hole::hole(
  extrude001,
  face = END,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 5, diameter = 1),
  holeType =   hole::simple(),
)`,
        { shouldNormalise: true }
      )
    })

    // TODO: edit flow
  })
})
