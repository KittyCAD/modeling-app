import type { Page } from '@playwright/test'

import { bracket } from '@e2e/playwright/fixtures/bracket'
import type { CmdBarSerialised } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  KCL_DEFAULT_INSTANCES,
  KCL_DEFAULT_LENGTH,
} from '@src/lib/constants'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

// test file is for testing point an click code gen functionality that's not sketch mode related

test.describe('Point-and-click tests - sketch v1', { tag: '@desktop' }, () => {
  test.use({ userFeatures: [EXPERIMENTAL_POINT_AND_CLICK_FLAG] })

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
    await scene.settled()

    await test.step(`Edit first extrude via feature tree`, async () => {
      await (await toolbar.getFeatureTreeOperation('bracketBody', 0)).dblclick()
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
      await (
        await toolbar.getFeatureTreeOperation('shelfMountingHoles', 0)
      ).dblclick()
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
      await (
        await toolbar.getFeatureTreeOperation('wallMountingHoles', 0)
      ).dblclick()
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
    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, code)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Add extrude with tags', async () => {
      await test.step('Open extrude command from toolbar', async () => {
        await toolbar.extrudeButton.click()
      })
      await test.step('Select profile', async () => {
        await editor.selectText('circle')
        await cmdBar.progressCmdBar()
      })
      await test.step('Set length', async () => {
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'length',
          currentArgValue: '5',
          headerArguments: {
            Profiles: '1 edge',
            Length: '5',
          },
          highlightedHeaderArg: 'length',
          commandName: 'Extrude',
        })
        await page.keyboard.insertText('4')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'bodyType',
          currentArgValue: '',
          headerArguments: {
            Length: '4',
            Profiles: '1 edge',
            BodyType: '',
          },
          highlightedHeaderArg: 'bodyType',
          commandName: 'Extrude',
        })
        await cmdBar.selectOption({ name: 'Surface' }).click()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Length: '4',
            Profiles: '1 edge',
            BodyType: 'SURFACE',
          },
          commandName: 'Extrude',
        })
      })
      await test.step('Set end tag', async () => {
        await cmdBar.clickOptionalArgument('tagEnd')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'tagEnd$',
          currentArgValue: '',
          headerArguments: {
            Length: '4',
            Profiles: '1 edge',
            BodyType: 'SURFACE',
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
            Profiles: '1 edge',
            BodyType: 'SURFACE',
            TagEnd: 'myEndTag',
          },
          commandName: 'Extrude',
        })
      })
      await test.step('Submit and verify', async () => {
        await cmdBar.submit()
        await editor.expectEditor.toContain('extrude(')
        await editor.expectEditor.toContain('profile001')
        await editor.expectEditor.toContain('length = 4')
        await editor.expectEditor.toContain('tagEnd = $myEndTag')
        await editor.expectEditor.toContain('bodyType = SURFACE')
      })
    })

    await test.step(`Edit first extrude via feature tree`, async () => {
      await test.step('Open extrude operation from feature tree', async () => {
        await (await toolbar.getFeatureTreeOperation('Extrude', 0)).dblclick()
      })
      await test.step('Edit length argument', async () => {
        await cmdBar.clickHeaderArgument('length')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'length',
          currentArgValue: '4',
          headerArguments: {
            Length: '4',
            BodyType: 'SURFACE',
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
            BodyType: 'SURFACE',
            TagEnd: 'myEndTag',
          },
          commandName: 'Extrude',
        })
      })
      await test.step('Submit and verify', async () => {
        await cmdBar.submit()
        await editor.expectEditor.toContain('extrude(')
        await editor.expectEditor.toContain('profile001')
        await editor.expectEditor.toContain('length = 3')
        await editor.expectEditor.toContain('tagEnd = $myEndTag')
        await editor.expectEditor.toContain('bodyType = SURFACE')
      })
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
    context,
  }) => {
    const viewPortSize = { width: 1200, height: 500 }

    await page.setBodyDimensions(viewPortSize)
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, `sketch001 = startSketchOn(XZ)`)
    await homePage.goToModelingScene()
    await scene.connectionEstablished()

    // Constants and locators
    // These are mappings from screenspace to KCL coordinates,
    // until we merge in our coordinate system helpers
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
      const op = await toolbar.getFeatureTreeOperation('sketch001', 0)
      await op.dblclick()
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
    page.on('console', console.log)

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

    const [_clickOpenPath, moveToOpenPath, dblClickOpenPath] =
      scene.makeMouseHelpers(0.65, 0.5, { format: 'ratio' })

    const [_clickCircle, moveToCircle, dblClickCircle] = scene.makeMouseHelpers(
      0.63,
      0.5,
      { format: 'ratio' }
    )

    await test.step(`Double-click on the closed sketch`, async () => {
      await scene.settled()
      await editor.closePane()
      await moveToCircle()
      await page.waitForTimeout(1000)
      await dblClickCircle()
      await page.waitForTimeout(1000)
      await expect(toolbar.exitSketchBtn).toBeVisible()
      await editor.openPane()
      await editor.expectState({
        activeLines: [`|>circle(center=[8,5],radius=2)`],
        highlightedCode: 'circle(center=[8,5],radius=2)',
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
        highlightedCode: 'tangentialArc(endAbsolute=[10,0])',
        diagnostics: [],
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
    context,
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
    const timeout = 150

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, `sketch001 = startSketchOn(XY)`)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Select and deselect a single sketch segment', async () => {
      await test.step('Get into sketch mode', async () => {
        await editor.closePane()
        const op = await toolbar.getFeatureTreeOperation('sketch001', 0)
        await op.dblclick()
        await toolbar.waitUntilSketchingReady()
        await toolbar.closeFeatureTreePane()
        if ((await toolbar.lineBtn.getAttribute('aria-pressed')) !== 'true') {
          await page.keyboard.press('l')
        }
        await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')
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
        await expect(toolbar.selectionStatus).toContainText('1 edge')
      })
      await test.step('Select the second segment (Shift-click)', async () => {
        await page.keyboard.down('Shift')
        await page.waitForTimeout(timeout)
        await clickSecondSegment()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await expect(toolbar.selectionStatus).toContainText('2 edges')
      })
      await test.step('Deselect the first segment', async () => {
        await page.keyboard.down('Shift')
        await page.waitForTimeout(timeout)
        await clickFirstSegment()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await expect(toolbar.selectionStatus).toContainText('1 edge')
      })
      await test.step('Deselect the second segment', async () => {
        await page.keyboard.down('Shift')
        await page.waitForTimeout(timeout)
        await clickSecondSegment()
        await page.waitForTimeout(timeout)
        await page.keyboard.up('Shift')
        await expect(toolbar.selectionStatus).toContainText('No selection')
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
    await scene.settled()

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
      await cmdBar.progressCmdBar()
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
        'plane001',
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
    await scene.settled()

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
          Edge: `1 edge`,
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
          Edge: `1 edge`,
          AngleStart: '0',
          Revolutions: '20',
          Radius: '1',
          CounterClockWise: 'true',
        },
        commandName: 'Helix',
      })
      await cmdBar.submit()
      await scene.settled()
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
          CounterClockWise: 'true',
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
          CounterClockWise: 'true',
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
          CounterClockWise: 'true',
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
          CounterClockWise: 'false',
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
          ccw = false,
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
    await page.setBodyDimensions({ width: 1500, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()

    const loftDeclaration =
      'loft001 = loft([sketch001, sketch002], bodyType = SURFACE)'
    const editedLoftDeclaration =
      'loft001 = loft([sketch001, sketch002], vDegree = 3, bodyType = SURFACE)'

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
        stage: 'arguments',
        currentArgKey: 'bodyType',
        currentArgValue: '',
        headerArguments: { Profiles: '2 edges', BodyType: '' },
        highlightedHeaderArg: 'bodyType',
        commandName: 'Loft',
      })
      await cmdBar.selectOption({ name: 'Surface' }).click()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: { Profiles: '2 edges', BodyType: 'SURFACE' },
        commandName: 'Loft',
      })
      await cmdBar.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled()
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
        headerArguments: {
          BodyType: 'SURFACE',
        },
        commandName: 'Loft',
      })
      await cmdBar.clickOptionalArgument('vDegree')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'vDegree',
        currentArgValue: '',
        headerArguments: {
          BodyType: 'SURFACE',
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
          BodyType: 'SURFACE',
          VDegree: '3',
        },
        commandName: 'Loft',
      })
      await cmdBar.submit()
      await scene.settled()
      await editor.expectEditor.toContain(editedLoftDeclaration)
    })

    await test.step('Delete loft via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation('Loft', 0)
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
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
    const sweepDeclaration = `sweep001 = sweep(
  profile001,
  path = helix001,
  bodyType = SURFACE,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`
    const editedSweepDeclaration = `sweep001 = sweep(
  profile001,
  path = helix001,
  sectional = true,
  bodyType = SURFACE,
  version = 2,
  translateProfileToPath = false,
  orientProfilePerpendicular = false,
)`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await homePage.goToModelingScene()
    await scene.settled()

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
          Profiles: '1 edge',
          Path: '',
          BodyType: '',
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
          Profiles: '1 edge',
          Path: '',
          BodyType: '',
        },
        highlightedHeaderArg: 'path',
        stage: 'arguments',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Sweep',
        currentArgKey: 'bodyType',
        currentArgValue: '',
        headerArguments: {
          Profiles: '1 edge',
          Path: '1 helix',
          BodyType: '',
        },
        highlightedHeaderArg: 'bodyType',
        stage: 'arguments',
      })
      await cmdBar.selectOption({ name: 'Surface' }).click()
      await cmdBar.expectState({
        commandName: 'Sweep',
        headerArguments: {
          Profiles: '1 edge',
          Path: '1 helix',
          BodyType: 'SURFACE',
        },
        stage: 'review',
      })
      await cmdBar.progressCmdBar(true)
      await editor.expectEditor.toContain(sweepDeclaration, {
        shouldNormalise: true,
      })
    })

    await test.step('Go through the edit flow via feature tree', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const op = await toolbar.getFeatureTreeOperation('Sweep', 0)
      await op.dblclick()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          BodyType: 'SURFACE',
          Version: '2',
          TranslateProfileToPath: 'false',
          OrientProfilePerpendicular: 'false',
        },
        commandName: 'Sweep',
      })
      await cmdBar.clickOptionalArgument('sectional')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'sectional',
        currentArgValue: '',
        headerArguments: {
          BodyType: 'SURFACE',
          Version: '2',
          TranslateProfileToPath: 'false',
          OrientProfilePerpendicular: 'false',
          Sectional: '',
        },
        highlightedHeaderArg: 'sectional',
        commandName: 'Sweep',
      })
      await cmdBar.selectOption({ name: 'On' }).click()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          BodyType: 'SURFACE',
          Version: '2',
          TranslateProfileToPath: 'false',
          OrientProfilePerpendicular: 'false',
          Sectional: 'true',
        },
        commandName: 'Sweep',
      })
      await cmdBar.submit()
      await editor.expectEditor.toContain(editedSweepDeclaration, {
        shouldNormalise: true,
      })
    })

    await test.step('Delete sweep via feature tree selection', async () => {
      const sweep = await toolbar.getFeatureTreeOperation('Sweep', 0)
      await sweep.click()
      await page.keyboard.press('Delete')
      await editor.expectEditor.not.toContain(editedSweepDeclaration, {
        shouldNormalise: true,
      })
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

    // Setup
    await test.step(`Initial test setup`, async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled()
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
          Selection: '1 edge',
          Radius: '',
        },
        stage: 'arguments',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Fillet',
        headerArguments: {
          Selection: '1 edge',
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
      await scene.settled()
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
      await scene.settled()
    })

    // Test
    await test.step('Delete fillet via feature tree selection', async () => {
      await test.step('Open Feature Tree Pane', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        await scene.settled()
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
          await scene.settled()
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
            'fillet03',
            0
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled()
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
            0
          )
          await operationButton.click({ button: 'left' })
          await page.keyboard.press('Delete')
          await scene.settled()
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
extrude001 = extrude(sketch001, length = 30)`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled()

    // One dumb hardcoded screen pixel value
    // Any idea here how to select a cap without clicking in the scene?
    const testPoint = { x: 575, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    const shellDeclaration =
      'shell001 = shell(extrude001, faces = capEnd001, thickness = 5)'
    const editedShellDeclaration =
      'shell001 = shell(extrude001, faces = capEnd001, thickness = 2)'

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
          Faces: '1 face',
          Thickness: '',
        },
        highlightedHeaderArg: 'thickness',
        commandName: 'Shell',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Faces: '1 face',
          Thickness: '5',
        },
        commandName: 'Shell',
      })
      await cmdBar.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled()
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
      await scene.settled()
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
      await scene.settled()
      await editor.expectEditor.not.toContain(shellDeclaration)
    })
  })

  test(`Delete Face point-and-click`, async ({
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
extrude001 = extrude(sketch001, length = 30)`
    const deleteDeclaration = `surface001 = deleteFace(extrude001, faces = capEnd001)`
    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await homePage.goToModelingScene()
    await scene.settled()

    // One dumb hardcoded screen pixel value
    const testPoint = { x: 575, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)

    await test.step(`Go through the command bar flow`, async () => {
      await toolbar.selectSurface('delete-face')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'faces',
        currentArgValue: '',
        headerArguments: {
          Faces: '',
        },
        highlightedHeaderArg: 'faces',
        commandName: 'Delete Face',
      })
      await clickOnCap()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Faces: '1 face',
        },
        commandName: 'Delete Face',
      })
      await cmdBar.submit()
    })

    await test.step(`Confirm code is added to the editor`, async () => {
      await scene.settled()
      await editor.expectEditor.toContain(deleteDeclaration)
    })

    await test.step('Delete delete face via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'surface001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(deleteDeclaration)
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
    const newCodeToFind =
      'revolve001 = revolve(  sketch002,  angle = 360deg,  axis = rectangleSegmentA001,  bodyType = SURFACE,)'

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)
    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled()

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
          Profiles: '1 edge',
          AxisOrEdge: '',
          Angle: '',
          BodyType: '',
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
          Profiles: '1 edge',
          Angle: '',
          AxisOrEdge: 'Edge',
          Edge: '',
          BodyType: '',
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
          Profiles: '1 edge',
          Angle: '',
          AxisOrEdge: 'Edge',
          Edge: '1 edge',
          BodyType: '',
        },
        highlightedHeaderArg: 'angle',
        stage: 'arguments',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        commandName: 'Revolve',
        currentArgKey: 'bodyType',
        currentArgValue: '',
        headerArguments: {
          Profiles: '1 edge',
          Angle: '360deg',
          AxisOrEdge: 'Edge',
          Edge: '1 edge',
          BodyType: '',
        },
        highlightedHeaderArg: 'bodyType',
        stage: 'arguments',
      })
      await cmdBar.selectOption({ name: 'Surface' }).click()
      await cmdBar.expectState({
        commandName: 'Revolve',
        headerArguments: {
          Profiles: '1 edge',
          Angle: '360deg',
          AxisOrEdge: 'Edge',
          Edge: '1 edge',
          BodyType: 'SURFACE',
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
          BodyType: 'SURFACE',
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
          BodyType: 'SURFACE',
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
      await scene.settled()
    })

    await test.step('Select an edge first (before opening translate)', async () => {
      await editor.selectText(segmentToSelect)
      await expect(toolbar.selectionStatus).toContainText('1 edge')
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
          reviewValidationError:
            'semantic: Expected `x`, `y`, or `z` to be provided.',
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
        await scene.settled()
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

  test('Flip Surface point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-6.79, 0])
  |> line(end = [11.46, 10.74])
  |> line(endAbsolute = [7.24, 0])
extrude001 = extrude(profile001, length = 5, bodyType = SURFACE)`
    const flipSurfaceDeclaration = `surface001 = flipSurface(extrude001)`

    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1500, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Start Flip Surface and select extrude001 in the feature tree', async () => {
      await toolbar.selectSurface('flip-surface')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'surface',
        currentArgValue: '',
        headerArguments: {
          Surface: '',
        },
        highlightedHeaderArg: 'surface',
        commandName: 'Flip Surface',
      })

      const operationButton = await toolbar.getFeatureTreeOperation(
        'extrude001',
        0
      )
      await operationButton.click({ button: 'left' })
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'surface',
        currentArgValue: '',
        headerArguments: {
          Surface: '',
        },
        highlightedHeaderArg: 'surface',
        commandName: 'Flip Surface',
      })
    })

    await test.step('Review and submit', async () => {
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Surface: '1 sweep',
        },
        commandName: 'Flip Surface',
      })
      await cmdBar.submit()
      await scene.settled()
    })

    await test.step('Verify code was added', async () => {
      await editor.expectEditor.toContain(flipSurfaceDeclaration)
    })

    await test.step('Delete flip surface via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'surface001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(flipSurfaceDeclaration)
    })
  })

  test('Join Surfaces point-and-click', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const firstSurface = `extrude001 = extrude(profile001, length = 5, bodyType = SURFACE)`
    const secondSurface = `extrude002 = extrude(profile002, length = 5, bodyType = SURFACE)`
    const initialCode = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [6.07, 1.66])
  |> yLine(length = -5.33)
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [-2, -3.87])
  |> line(endAbsolute = [0, 0])
${firstSurface}
${secondSurface}`
    const joinDeclaration = `surface001 = joinSurfaces([extrude001, extrude002])`

    await test.step('Settle the scene', async () => {
      await context.addInitScript((initialCode) => {
        localStorage.setItem('persistCode', initialCode)
      }, initialCode)
      await page.setBodyDimensions({ width: 1500, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled()
    })

    await test.step('Start Join and select two surfaces', async () => {
      await toolbar.selectSurface('join-surfaces')
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'selection',
        currentArgValue: '',
        headerArguments: {
          Selection: '',
        },
        highlightedHeaderArg: 'selection',
        commandName: 'Join Surfaces',
      })
      await page.keyboard.down('Shift')
      await (await toolbar.getFeatureTreeOperation('extrude001', 0)).click()
      await (await toolbar.getFeatureTreeOperation('extrude002', 0)).click()
      await page.keyboard.up('Shift')

      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Selection: '2 sweeps',
        },
        commandName: 'Join Surfaces',
      })
      await cmdBar.submit()
    })

    await test.step('Verify code was added', async () => {
      await scene.settled()
      await editor.expectEditor.toContain(joinDeclaration)
    })

    await test.step('Delete join via feature tree selection', async () => {
      await editor.closePane()
      const operationButton = await toolbar.getFeatureTreeOperation(
        'surface001',
        0
      )
      await operationButton.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain(joinDeclaration)
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
    await scene.settled()

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
      await scene.settled()
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
      await scene.settled()
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
      await scene.settled()
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
      await scene.settled()
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
            currentArgValue: 'X',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '8',
              Axis: '',
              Center: '',
            },
            highlightedHeaderArg: 'axis',
          })
          await page.keyboard.type('Y')
          await cmdBar.progressCmdBar()
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
              RotateDuplicates: 'true',
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
              RotateDuplicates: 'true',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
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
          'pattern001',
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
            RotateDuplicates: 'true',
            UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
            },
            reviewValidationError: undefined,
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'true',
              UseOriginal: 'false',
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
              RotateDuplicates: 'false',
              UseOriginal: 'false',
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
              RotateDuplicates: 'false',
              UseOriginal: 'false',
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
              RotateDuplicates: 'false',
              UseOriginal: 'true',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
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
        'pattern001',
        0
      )
      // Delete the pattern operation
      await patternOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
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
      await scene.settled()
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
            currentArgValue: 'X',
            headerArguments: {
              Solids: '1 sweep',
              Instances: '6',
              Distance: '8',
              Axis: '',
            },
            highlightedHeaderArg: 'axis',
          })
          await page.keyboard.type('Y')
          await cmdBar.progressCmdBar()
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
              UseOriginal: 'true',
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
              UseOriginal: 'true',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
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
          'pattern001',
          0
        )
        await patternOperation.dblclick()
        // Should open the command bar in edit mode
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'Pattern Linear 3D',
          currentArgKey: 'axis',
          currentArgValue: 'Y',
          headerArguments: {
            Instances: '6',
            Distance: '8',
            Axis: 'Y',
            UseOriginal: 'true',
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
              UseOriginal: 'true',
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
              UseOriginal: 'true',
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
              UseOriginal: 'true',
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
              UseOriginal: 'true',
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
              UseOriginal: 'true',
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
              UseOriginal: 'true',
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
              UseOriginal: 'false',
            },
          })
        })
      })

      await test.step('Submit and verify edited parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
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
        'pattern001',
        0
      )
      await patternOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')

      await scene.settled()
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
      await scene.settled()

      // Close panes to ensure toolbar buttons are visible
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    // Adjusted coordinates to center screen for clicking on cap
    const testPoint = { x: 500, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    await test.step('Add GDT Flatness to the scene', async () => {
      await test.step('Open GDT Flatness command from toolbar', async () => {
        await toolbar.selectGdtFlatness()
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
            currentArgValue: '0.1in',
            headerArguments: {
              Faces: '1 face',
              Tolerance: '',
            },
            highlightedHeaderArg: 'tolerance',
          })
          // Set tolerance to 0.1in
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.1in')
        })

        await test.step('Review basic parameters', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 face',
              Tolerance: '0.1in',
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
              Faces: '1 face',
              Tolerance: '0.1in',
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
              Faces: '1 face',
              Tolerance: '0.1in',
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
              Faces: '1 face',
              Tolerance: '0.1in',
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
              Faces: '1 face',
              Tolerance: '0.1in',
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
              Faces: '1 face',
              Tolerance: '0.1in',
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
              Faces: '1 face',
              Tolerance: '0.1in',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
            },
          })
        })

        await test.step('Configure font size', async () => {
          await cmdBar.clickOptionalArgument('fontSize')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'fontSize',
            currentArgValue: '10mm',
            headerArguments: {
              Faces: '1 face',
              Tolerance: '0.1in',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontSize: '',
            },
            highlightedHeaderArg: 'fontSize',
          })
          // Update font size to 12mm
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('12mm')
          await cmdBar.progressCmdBar()
          // Review changes to font size
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Faces: '1 face',
              Tolerance: '0.1in',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontSize: '12mm',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
        await editor.expectEditor.not.toContain('experimentalFeatures = allow')
        await editor.expectEditor.toContain('gdt::flatness(')
        await editor.expectEditor.toContain('faces = [capEnd001]')
        await editor.expectEditor.toContain('tolerance = 0.1in')
        await editor.expectEditor.toContain('precision = 5')
        await editor.expectEditor.toContain('framePosition = [10, 10]')
        await editor.expectEditor.toContain('framePlane = XY')
        await editor.expectEditor.toContain('fontSize = 12mm')
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
          currentArgValue: '0.1in',
          headerArguments: {
            Tolerance: '0.1in',
            Precision: '5',
            FramePosition: '[10, 10]',
            FramePlane: 'XY',
            FontSize: '12mm',
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
            currentArgValue: '0.1in',
            headerArguments: {
              Tolerance: '0.1in',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontSize: '12mm',
            },
            highlightedHeaderArg: 'tolerance',
          })
          // Update tolerance from 0.1in to 0.2in
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('0.2in')
          await cmdBar.progressCmdBar()
          // Review changes to tolerance
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2in',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontSize: '12mm',
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
              Tolerance: '0.2in',
              Precision: '5',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontSize: '12mm',
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
              Tolerance: '0.2in',
              Precision: '3',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontSize: '12mm',
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
              Tolerance: '0.2in',
              Precision: '3',
              FramePosition: '[10, 10]',
              FramePlane: 'XY',
              FontSize: '12mm',
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
              Tolerance: '0.2in',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XY',
              FontSize: '12mm',
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
              Tolerance: '0.2in',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XY',
              FontSize: '12mm',
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
              Tolerance: '0.2in',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
          })
        })

        await test.step('Edit font size', async () => {
          await page.getByRole('button', { name: 'FontSize' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Flatness',
            currentArgKey: 'fontSize',
            currentArgValue: '12mm',
            headerArguments: {
              Tolerance: '0.2in',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
            highlightedHeaderArg: 'fontSize',
          })
          // Update font size from 48 to 24
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('24')
          await cmdBar.progressCmdBar()
          // Review changes to font size
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Flatness',
            headerArguments: {
              Tolerance: '0.2in',
              Precision: '3',
              FramePosition: '[20, 30]',
              FramePlane: 'XZ',
              FontSize: '24',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
        await editor.expectEditor.toContain('gdt::flatness(')
        await editor.expectEditor.toContain('faces = [capEnd001]')
        await editor.expectEditor.toContain('tolerance = 0.2in')
        await editor.expectEditor.toContain('precision = 3')
        await editor.expectEditor.toContain('framePosition = [20, 30]')
        await editor.expectEditor.toContain('framePlane = XZ')
        await editor.expectEditor.toContain('fontSize = 24')
      })
    })

    await test.step('Delete GDT Flatness', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const gdtOperation = await toolbar.getFeatureTreeOperation('Flatness', 0)
      // Delete the GDT operation
      await gdtOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain('gdt::flatness(')
    })
  })

  test('GDT Datum from command bar', async ({
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
      await scene.settled()

      // Close panes to ensure toolbar buttons are visible
      await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
      await toolbar.closePane(DefaultLayoutPaneID.Code)
    })

    // Adjusted coordinates to center screen for clicking on cap
    const testPoint = { x: 500, y: 200 }
    const [clickOnCap] = scene.makeMouseHelpers(testPoint.x, testPoint.y)
    await test.step('Add GDT Datum to the scene', async () => {
      await test.step('Open GDT Datum command from toolbar', async () => {
        await page
          .getByRole('button', { name: 'caret down gdt: open menu' })
          .click()
        await expect(page.getByTestId('dropdown-gdt-datum')).toBeVisible()
        await page.getByTestId('dropdown-gdt-datum').click()
        await cmdBar.expectState({
          stage: 'arguments',
          commandName: 'GDT Datum',
          currentArgKey: 'faces',
          currentArgValue: '',
          headerArguments: {
            Faces: '',
            Name: '',
          },
          highlightedHeaderArg: 'faces',
        })
      })

      await test.step('Select face and configure basic parameters', async () => {
        await test.step('Select face', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'faces',
            currentArgValue: '',
            headerArguments: {
              Faces: '',
              Name: '',
            },
            highlightedHeaderArg: 'faces',
          })
          await clickOnCap()
        })

        await test.step('Configure name', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'name',
            currentArgValue: '',
            headerArguments: {
              Faces: '1 face',
              Name: '',
            },
            highlightedHeaderArg: 'name',
          })
          // Keep default name 'A'
        })

        await test.step('Review basic parameters', async () => {
          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Faces: '1 face',
              Name: 'A',
            },
          })
        })
      })

      await test.step('Configure optional parameters', async () => {
        await test.step('Configure frame position', async () => {
          await cmdBar.clickOptionalArgument('framePosition')

          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'framePosition',
            currentArgValue: '[0, 0]',
            headerArguments: {
              Faces: '1 face',
              Name: 'A',
              FramePosition: '',
            },
            highlightedHeaderArg: 'framePosition',
          })
          // Update frame position from [0, 0] to [5, 0]
          await page.getByTestId('vector2d-x-input').fill('5')
          await page.getByTestId('vector2d-y-input').fill('0')
          await cmdBar.progressCmdBar()
          // Review changes to frame position
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Faces: '1 face',
              Name: 'A',
              FramePosition: '[5, 0]',
            },
          })
        })

        await test.step('Configure frame plane', async () => {
          await cmdBar.clickOptionalArgument('framePlane')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'framePlane',
            currentArgValue: '',
            headerArguments: {
              Faces: '1 face',
              Name: 'A',
              FramePosition: '[5, 0]',
              FramePlane: '',
            },
            highlightedHeaderArg: 'framePlane',
          })
          // Select XZ plane and auto-progress
          await cmdBar.selectOption({ name: 'XZ' }).click()
          // Review changes to frame plane
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Faces: '1 face',
              Name: 'A',
              FramePosition: '[5, 0]',
              FramePlane: 'XZ',
            },
          })
        })

        await test.step('Configure font size', async () => {
          await cmdBar.clickOptionalArgument('fontSize')
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'fontSize',
            currentArgValue: '10mm',
            headerArguments: {
              Faces: '1 face',
              Name: 'A',
              FramePosition: '[5, 0]',
              FramePlane: 'XZ',
              FontSize: '',
            },
            highlightedHeaderArg: 'fontSize',
          })
          // Update font size to 12mm
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('12mm')
          await cmdBar.progressCmdBar()
          // Review changes to font size
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Faces: '1 face',
              Name: 'A',
              FramePosition: '[5, 0]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
        await editor.expectEditor.not.toContain('experimentalFeatures = allow')
        await editor.expectEditor.toContain('gdt::datum(')
        await editor.expectEditor.toContain('face = capEnd001')
        await editor.expectEditor.toContain('name = "A"')
        await editor.expectEditor.toContain('framePosition = [5, 0]')
        await editor.expectEditor.toContain('framePlane = XZ')
        await editor.expectEditor.toContain('fontSize = 12mm')
      })
    })

    await test.step('Edit GDT Datum', async () => {
      await test.step('Open edit mode from feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const gdtOperation = await toolbar.getFeatureTreeOperation('Datum', 0)
        await gdtOperation.dblclick()
        // Should open the command bar in edit mode
      })

      await test.step('Edit parameters', async () => {
        await test.step('Edit name from A to B', async () => {
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'name',
            currentArgValue: '',
            headerArguments: {
              Name: 'A',
              FramePosition: '[5, 0]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
            highlightedHeaderArg: 'name',
          })
          // Update name from A to B
          await expect(cmdBar.currentArgumentInput).toBeVisible()
          await cmdBar.currentArgumentInput.fill('B')
          await cmdBar.progressCmdBar()
          // Review changes to name
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Name: 'B',
              FramePosition: '[5, 0]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
          })
        })

        await test.step('Edit frame position', async () => {
          await page.getByRole('button', { name: 'FramePosition' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'framePosition',
            currentArgValue: '[5, 0]',
            headerArguments: {
              Name: 'B',
              FramePosition: '[5, 0]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
            highlightedHeaderArg: 'framePosition',
          })
          // Update frame position from [5, 0] to [10, 5]
          await page.getByTestId('vector2d-x-input').fill('10')
          await page.getByTestId('vector2d-y-input').fill('5')
          await cmdBar.progressCmdBar()
          // Review changes to frame position
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Name: 'B',
              FramePosition: '[10, 5]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
          })
        })

        await test.step('Edit frame plane', async () => {
          await page.getByRole('button', { name: 'FramePlane' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'framePlane',
            currentArgValue: '',
            headerArguments: {
              Name: 'B',
              FramePosition: '[10, 5]',
              FramePlane: 'XZ',
              FontSize: '12mm',
            },
            highlightedHeaderArg: 'framePlane',
          })
          // Update frame plane from XZ to YZ
          await cmdBar.selectOption({ name: 'YZ' }).click()
          // Review changes to frame plane
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Name: 'B',
              FramePosition: '[10, 5]',
              FramePlane: 'YZ',
              FontSize: '12mm',
            },
          })
        })

        await test.step('Edit font size', async () => {
          await page.getByRole('button', { name: 'FontSize' }).click()
          await cmdBar.expectState({
            stage: 'arguments',
            commandName: 'GDT Datum',
            currentArgKey: 'fontSize',
            currentArgValue: '12mm',
            headerArguments: {
              Name: 'B',
              FramePosition: '[10, 5]',
              FramePlane: 'YZ',
              FontSize: '12mm',
            },
            highlightedHeaderArg: 'fontSize',
          })
          // Update font size from 48 to 32
          await cmdBar.currentArgumentInput.locator('.cm-content').fill('32')
          await cmdBar.progressCmdBar()
          // Review changes to font size
          await cmdBar.expectState({
            stage: 'review',
            commandName: 'GDT Datum',
            headerArguments: {
              Name: 'B',
              FramePosition: '[10, 5]',
              FramePlane: 'YZ',
              FontSize: '32',
            },
          })
        })
      })

      await test.step('Submit and verify all parameters', async () => {
        await cmdBar.progressCmdBar()
        await scene.settled()
        await editor.expectEditor.toContain('gdt::datum(')
        await editor.expectEditor.toContain('face = capEnd001')
        await editor.expectEditor.toContain('name = "B"')
        await editor.expectEditor.toContain('framePosition = [10, 5]')
        await editor.expectEditor.toContain('framePlane = YZ')
        await editor.expectEditor.toContain('fontSize = 32')
      })
    })

    await test.step('Delete GDT Datum', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const gdtOperation = await toolbar.getFeatureTreeOperation('Datum', 0)
      // Delete the GDT operation
      await gdtOperation.click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled()
      await editor.expectEditor.not.toContain('gdt::datum(')
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
      await scene.settled()

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
          Face: '1 face',
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
          Face: '1 face',
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
        currentArgValue: '2',
        commandName: 'Hole',
        headerArguments: {
          Face: '1 face',
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
          Face: '1 face',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '2',
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
          Face: '1 face',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '2',
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
          Face: '1 face',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '2',
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
          Face: '1 face',
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'simple',
          HoleBottom: 'flat',
        },
      })
      await cmdBar.submit()
    })

    await test.step('Expect hole call added to the editor', async () => {
      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(
        `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-5, -5])
  |> angledLine(angle = 0deg, length = 10, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) + 90deg, length = 10)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 10, tagEnd = $capEnd001)
hole001 = hole::hole(
  extrude001,
  face = capEnd001,
  cutAt = [0, 0],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 2, diameter = 1),
  holeType =   hole::simple(),
)`,
        { shouldNormalise: true }
      )
    })

    await test.step('Edit the hole from the feature-tree', async () => {
      await toolbar.closePane(DefaultLayoutPaneID.Code)
      await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      const holeOperation = await toolbar.getFeatureTreeOperation('Hole', 0)
      await holeOperation.dblclick()
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'simple',
          HoleBottom: 'flat',
        },
        commandName: 'Hole',
      })
      await page.getByRole('button', { name: 'CutAt' }).click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'cutAt',
        currentArgValue: '[0, 0]',
        commandName: 'Hole',
        headerArguments: {
          CutAt: '[0, 0]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'simple',
          HoleBottom: 'flat',
        },
        highlightedHeaderArg: 'cutAt',
      })
      // Update cut at from [0, 0] to [2, 2]
      await page.getByTestId('vector2d-x-input').fill('2')
      await page.getByTestId('vector2d-y-input').fill('2')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Hole',
        headerArguments: {
          CutAt: '[2, 2]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'simple',
          HoleBottom: 'flat',
        },
      })
      await page.getByRole('button', { name: 'HoleType' }).click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'holeType',
        currentArgValue: '',
        commandName: 'Hole',
        headerArguments: {
          CutAt: '[2, 2]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'simple',
          HoleBottom: 'flat',
        },
        highlightedHeaderArg: 'holeType',
      })
      await cmdBar.selectOption({ name: 'Countersink' }).click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'countersinkAngle',
        currentArgValue: '90deg',
        commandName: 'Hole',
        headerArguments: {
          CutAt: '[2, 2]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'countersink',
          CountersinkDiameter: '',
          CountersinkAngle: '',
          HoleBottom: 'flat',
        },
        highlightedHeaderArg: 'countersinkAngle',
      })
      await cmdBar.currentArgumentInput.locator('.cm-content').fill('80deg')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'countersinkDiameter',
        currentArgValue: '2',
        commandName: 'Hole',
        headerArguments: {
          CutAt: '[2, 2]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'countersink',
          CountersinkDiameter: '',
          CountersinkAngle: '80deg',
          HoleBottom: 'flat',
        },
        highlightedHeaderArg: 'countersinkDiameter',
      })
      await cmdBar.currentArgumentInput.locator('.cm-content').fill('3')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Hole',
        headerArguments: {
          CutAt: '[2, 2]',
          HoleBody: 'blind',
          BlindDepth: '2',
          BlindDiameter: '1',
          HoleType: 'countersink',
          CountersinkDiameter: '3',
          CountersinkAngle: '80deg',
          HoleBottom: 'flat',
        },
      })
      await cmdBar.submit()
    })

    await test.step('Expect hole call updated in the editor', async () => {
      await scene.settled()
      await toolbar.openPane(DefaultLayoutPaneID.Code)
      await editor.expectEditor.toContain(
        `hole001 = hole::hole(
  extrude001,
  face = capEnd001,
  cutAt = [2, 2],
  holeBottom =   hole::flat(),
  holeBody =   hole::blind(depth = 2, diameter = 1),
  holeType =   hole::countersink(angle = 80deg, diameter = 3),
)`,
        { shouldNormalise: true }
      )
    })
  })
})
