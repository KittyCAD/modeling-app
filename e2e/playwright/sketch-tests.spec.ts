import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { roundOff } from '@src/lib/utils'

import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import {
  NUMBER_REGEXP,
  getMovementUtils,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Sketch tests', () => {
  test('three-point arc closes without disappearing', async ({
    page,
    homePage,
    scene,
    toolbar,
    editor,
    cmdBar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', '')
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await toolbar.startSketchPlaneSelection()
    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)
    await selectXZPlane()
    await page.waitForTimeout(600)
    await editor.expectEditor.toContain('startSketchOn(XZ)')

    //await toolbar.lineBtn.click()
    const [lineStart] = scene.makeMouseHelpers(600, 400)
    const [lineEnd] = scene.makeMouseHelpers(600, 200)
    await lineStart()
    await page.waitForTimeout(300)
    await lineEnd()
    await editor.expectEditor.toContain('|> yLine(')

    await toolbar.selectThreePointArc()
    await page.waitForTimeout(200)

    await lineEnd()
    await page.waitForTimeout(200)

    const [arcInteriorMove, arcInterior] = (() => {
      const [click, move] = scene.makeMouseHelpers(750, 300)
      return [move, click]
    })()
    await arcInteriorMove()
    await arcInterior()
    await page.waitForTimeout(200)

    await lineStart() // close
    await page.waitForTimeout(300)

    await page.keyboard.press('Escape')
    await page.waitForTimeout(2000)

    await editor.expectEditor.toContain('arc(')
  })
  test('multi-sketch file shows multiple Edit Sketch buttons', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    const selectionsSnippets = {
      startProfileAt1:
        '|> startProfile(at = [-width / 4 + screwRadius, height / 2])',
      startProfileAt2: '|> startProfile(at = [-width / 2, 0])',
      startProfileAt3: '|> startProfile(at = [0, thickness])',
    }
    await context.addInitScript(
      async ({ startProfileAt1, startProfileAt2, startProfileAt3 }: any) => {
        localStorage.setItem(
          'persistCode',
          `
    width = 20
    height = 10
    thickness = 5
    screwRadius = 3
    wireRadius = 2
    wireOffset = 0.5

    screwHole = startSketchOn(XY)
  ${startProfileAt1}
  |> arc(angleStart = 0, angleEnd = 360deg, radius = screwRadius)

    part001 = startSketchOn(XY)
  ${startProfileAt2}
  |> xLine(length = width * .5)
  |> yLine(length = height)
  |> xLine(length = -width * .5)
  |> close()
  |> subtract2d(tool = screwHole)
  |> extrude(length = thickness)

  part002 = startSketchOn(-XZ)
  ${startProfileAt3}
  |> xLine(length = width / 4)
  |> tangentialArc(endAbsolute = [width / 2, 0])
  |> xLine(length = -width / 4 + wireRadius)
  |> yLine(length = wireOffset)
  |> arc(angleStart = 0, angleEnd = 180deg, radius = wireRadius)
  |> yLine(length = -wireOffset)
  |> xLine(length = -width / 4)
  |> close()
  |> extrude(length = -height)
    `
        )
      },
      selectionsSnippets
    )
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await page.getByText(selectionsSnippets.startProfileAt1).click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()

    await page.getByText(selectionsSnippets.startProfileAt2).click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()

    await page.getByText(selectionsSnippets.startProfileAt3).click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
  })

  test('Can exit selection of face', async ({ page, homePage }) => {
    // Load the app with the code panes
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', ``)
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()

    await expect(page.getByText('select a plane or face')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()
  })

  test('Can select planes in Feature Tree after Start Sketch', async ({
    page,
    homePage,
    toolbar,
    editor,
  }) => {
    // Load the app with empty code
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `plane001 = offsetPlane(XZ, offset = 5)`
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await test.step('Click Start Sketch button', async () => {
      await page.getByRole('button', { name: 'Start Sketch' }).click()
      await expect(
        page.getByRole('button', { name: 'Exit Sketch' })
      ).toBeVisible()
      await expect(page.getByText('select a plane or face')).toBeVisible()
    })

    await test.step('Open feature tree and select Front plane (XZ)', async () => {
      await toolbar.openFeatureTreePane()

      await page.getByRole('button', { name: 'Front plane' }).click()

      await page.waitForTimeout(600)

      await expect(toolbar.lineBtn).toBeEnabled()
      await editor.expectEditor.toContain('startSketchOn(XZ)')

      await page.getByRole('button', { name: 'Exit Sketch' }).click()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeVisible()
    })

    await test.step('Click Start Sketch button again', async () => {
      await page.getByRole('button', { name: 'Start Sketch' }).click()
      await expect(
        page.getByRole('button', { name: 'Exit Sketch' })
      ).toBeVisible()
    })

    await test.step('Select the offset plane', async () => {
      await toolbar.openFeatureTreePane()

      await page.getByRole('button', { name: 'Offset plane' }).click()

      await page.waitForTimeout(600)

      await expect(toolbar.lineBtn).toBeEnabled()
      await editor.expectEditor.toContain('startSketchOn(plane001)')
    })
  })

  test('Can edit a circle center and radius by dragging its handles', async ({
    page,
    editor,
    homePage,
    scene,
    cmdBar,
    toolbar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 0.5)`
      )
    })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    let prevContent = await editor.getCurrentCode()

    await test.step('enter sketch and expect circle', async () => {
      await toolbar.editSketch()
      await expect(page.getByTestId('segment-overlay')).toHaveCount(1)
    })

    await test.step('drag circle center handle', async () => {
      const fromPoint = { x: 0.5, y: 0.5 }
      const toPoint = [fromPoint.x - 0.1, fromPoint.y - 0.1] as const
      const [dragCenterHandle] = scene.makeDragHelpers(...toPoint, {
        debug: true,
        format: 'ratio',
      })
      await dragCenterHandle({ fromPoint })
      await editor.expectEditor.not.toContain(prevContent)
      prevContent = await editor.getCurrentCode()
    })

    await test.step('drag circle radius handle', async () => {
      const magicYOnCircle = 0.8
      const fromPoint = { x: 0.5, y: magicYOnCircle }
      const toPoint = [fromPoint.x / 2, magicYOnCircle] as const
      const [dragRadiusHandle] = scene.makeDragHelpers(...toPoint, {
        debug: true,
        format: 'ratio',
      })
      await dragRadiusHandle({ fromPoint })
      await editor.expectEditor.not.toContain(prevContent)
      prevContent = await editor.getCurrentCode()
    })

    await test.step('expect the code to have changed', async () => {
      await editor.expectEditor.toContain(
        `sketch001 = startSketchOn(XZ)
    |> circle(center = [-0.18, 0.12], radius = 0.54)`,
        { shouldNormalise: true }
      )
    })
  })
  test(
    'Can edit a sketch that has been extruded in the same pipe',
    { tag: '@web' },
    async ({ page, homePage, editor, toolbar, scene, cmdBar }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit=in)
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [5, 0])
  |> tangentialArc(end = [5, 5])
  |> close()
  |> extrude(length = 5)`
        )
      })

      await homePage.goToModelingScene()
      await toolbar.waitForFeatureTreeToBeBuilt()
      await scene.settled(cmdBar)

      await editor.closePane()
      await toolbar.editSketch()
      await expect(page.getByTestId('segment-overlay')).toHaveCount(3)
      let prevContent = await editor.getCurrentCode()

      await test.step('drag startProfileAt handle', async () => {
        const [_, dragProfileStartFrom] = scene.makeDragHelpers(0.5, 0.5, {
          format: 'ratio',
          steps: 5,
        })

        await dragProfileStartFrom({
          toPoint: { x: 0.4, y: 0.6 },
          pixelDiff: 200,
        })
        await editor.expectEditor.not.toContain(prevContent, {
          shouldNormalise: true,
        })
      })
    }
  )

  test('Can add multiple sketches', async ({
    page,
    homePage,
    scene,
    toolbar,
    cmdBar,
    editor,
  }) => {
    const viewportSize = { width: 1200, height: 500 }
    await page.setBodyDimensions(viewportSize)

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 }
    const { click00r } = getMovementUtils({ center, page })

    let codeStr =
      '@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XY)'

    await toolbar.startSketchBtn.click()
    const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
    await clickCenter()
    await editor.expectEditor.toContain(codeStr)

    await click00r(0, 0)
    await page.waitForTimeout(100)
    await editor.expectEditor.toContain(
      `profile001 = startProfile(sketch001, at =`
    )

    await click00r(50, 0)
    await page.waitForTimeout(100)
    await editor.expectEditor.toContain(`|> xLine(length =`)

    await click00r(0, 50)
    // @pierremtb: this used to create a yLine before the engine zoom fix
    // in https://github.com/KittyCAD/engine/pull/3804. I updated it to a line call
    // since it doesn't change the test objective
    await editor.expectEditor.toContain(`|> line(`)

    // exit the sketch, reset relative clicker
    await click00r(undefined, undefined)
    await toolbar.exitSketch()
    await scene.settled(cmdBar)

    // start a new sketch
    await toolbar.startSketchBtn.click()
    await clickCenter()
    await page.waitForTimeout(600) // TODO detect animation ending, or disable animation
    await editor.expectEditor.toContain(`sketch002 = startSketchOn(XY)`)

    await click00r(30, 0)
    await editor.expectEditor.toContain(
      `profile002 = startProfile(sketch002, at =`
    )
    await toolbar.exitSketch()
  })

  test.describe('Snap to close works (at any scale)', () => {
    const doSnapAtDifferentScales = async (
      page: Page,
      scene: SceneFixture,
      editor: EditorFixture,
      camPos: [number, number, number],
      scale = 1
    ) => {
      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await u.openDebugPanel()

      const code = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(-XZ)
profile001 = startProfile(sketch001, at = [${roundOff(scale * 76.94)}, ${roundOff(
        scale * 35.11
      )}])
    |> xLine(length = ${roundOff(scale * 153.87)})
    |> yLine(length = -${roundOff(scale * 139.66)})
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).toBeVisible()

      await u.clearCommandLogs()
      await page.getByRole('button', { name: 'Start Sketch' }).click()
      await page.waitForTimeout(100)

      await u.openAndClearDebugPanel()
      await u.updateCamPosition(camPos)
      await u.closeDebugPanel()

      await page.mouse.move(0, 0)

      // select a plane
      await page.mouse.move(700, 200, { steps: 10 })
      await page.mouse.click(700, 200, { delay: 200 })
      await editor.expectEditor.toContain(
        `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(-XZ)`
      )

      await editor.closePane()

      // draw three lines
      await page.waitForTimeout(500)
      const pointA = await scene.convertPagePositionToStream(700, 200)
      const pointB = await scene.convertPagePositionToStream(900, 200)
      const pointC = await scene.convertPagePositionToStream(900, 400)

      await page.mouse.move(pointA.x, pointA.y, { steps: 10 })
      await page.mouse.click(pointA.x, pointA.y, { delay: 200 })
      await page.waitForTimeout(100)

      await page.mouse.move(pointB.x, pointB.y, { steps: 10 })
      await page.mouse.click(pointB.x, pointB.y, { delay: 200 })
      await page.waitForTimeout(100)

      await page.mouse.move(pointC.x, pointC.y, { steps: 10 })
      await page.mouse.click(pointC.x, pointC.y, { delay: 200 })
      await page.waitForTimeout(100)

      await page.mouse.move(pointA.x - 12, pointA.y + 12, { steps: 10 })
      const pointNotQuiteA = { x: pointA.x - 7, y: pointA.y + 7 }
      await page.mouse.move(pointNotQuiteA.x, pointNotQuiteA.y, {
        steps: 10,
      })

      await page.mouse.click(pointNotQuiteA.x, pointNotQuiteA.y, {
        delay: 200,
      })

      await editor.expectEditor.toContain(code, { shouldNormalise: true })

      // Assert the tool stays equipped after a profile is closed (ready for the next one)
      await expect(
        page.getByRole('button', { name: 'line Line', exact: true })
      ).toHaveAttribute('aria-pressed', 'true')
    }
    test('[0, 100, 100]', async ({ page, homePage, scene, editor }) => {
      await homePage.goToModelingScene()
      await doSnapAtDifferentScales(page, scene, editor, [0, 100, 100], 0.01)
    })

    test('[0, 10000, 10000]', async ({ page, homePage, scene, editor }) => {
      await homePage.goToModelingScene()
      await doSnapAtDifferentScales(page, scene, editor, [0, 10000, 10000])
    })
  })
  test('exiting a close extrude, has the extrude button enabled ready to go', async ({
    page,
    homePage,
    cmdBar,
    toolbar,
  }) => {
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [-0.45, 0.87])
    |> line(end = [1.32, 0.38])
    |> line(end = [1.02, -1.32], tag = $seg01)
    |> line(end = [-1.01, -0.77])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  `
      )
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // click profile in code
    await page.getByText(`startProfile(at = [-0.45, 0.87])`).click()
    await page.waitForTimeout(100)
    await expect(page.getByRole('button', { name: 'Edit Sketch' })).toBeEnabled(
      { timeout: 10_000 }
    )
    // click edit sketch
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(600) // wait for animation

    // exit sketch
    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    // expect extrude button to be enabled
    await expect(toolbar.extrudeButton).not.toBeDisabled()

    // click extrude
    await toolbar.extrudeButton.click()

    // sketch selection should already have been made.
    // otherwise the cmdbar would be waiting for a selection.
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'arguments',
      currentArgKey: 'length',
      currentArgValue: '5',
      headerArguments: { Profiles: '1 profile', Length: '' },
      highlightedHeaderArg: 'length',
      commandName: 'Extrude',
    })
  })
  test("Existing sketch with bad code delete user's code", async ({
    page,
    homePage,
    scene,
    cmdBar,
    toolbar,
    editor,
  }) => {
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [-0.45, 0.87])
    |> line(end = [1.32, 0.38])
    |> line(end = [1.02, -1.32], tag = $seg01)
    |> line(end = [-1.01, -0.77])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(sketch001, length = 5)
  `
      )
    })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    await toolbar.startSketchBtn.click()

    // Click the end face of extrude001
    // await page.mouse.click(622, 355)
    const [clickOnEndFace] = scene.makeMouseHelpers(0.5, 0.7, {
      format: 'ratio',
    })
    await clickOnEndFace()

    // The click should generate a new sketch starting on the end face of extrude001
    // signified by the implicit 'END' tag for that solid.
    await page.waitForTimeout(800)
    await page.getByText(`END)`).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('  |>', { delay: 100 })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    expect((await editor.getCurrentCode()).replace(/\s/g, '')).toBe(
      `sketch001 = startSketchOn(XZ)
    |> startProfile(at = [-0.45, 0.87])
    |> line(end = [1.32, 0.38])
    |> line(end = [1.02, -1.32], tag = $seg01)
    |> line(end = [-1.01, -0.77])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(sketch001, length = 5)
  sketch002 = startSketchOn(extrude001, face = END)
    |>
  `.replace(/\s/g, '')
    )
  })

  test('Can attempt to sketch on revolved face', async ({
    page,
    homePage,
    scene,
    cmdBar,
    toolbar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `lugHeadLength = 0.25
      lugDiameter = 0.5
      lugLength = 2

      fn lug(origin, length, diameter, plane) {
        lugSketch = startSketchOn(plane)
          |> startProfile(at = [origin[0] + lugDiameter / 2, origin[1]])
          |> angledLine(angle = 60deg, lengthY = lugHeadLength)
          |> xLine(endAbsolute = 0 + .001)
          |> yLine(endAbsolute = 0)
          |> close()
          |> revolve(axis = Y)

        return lugSketch
      }

      lug(origin = [0, 0], length = 10, diameter = .5, plane = XY)`
      )
    })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
    await toolbar.startSketchBtn.click()
    await page.waitForTimeout(20_000) // Wait for unavoidable animation
    await clickCenter()
    await page.waitForTimeout(1000) // Wait for unavoidable animation

    await expect(toolbar.exitSketchBtn).toBeEnabled()
    await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')
  })

  test('sketch on face of a boolean works', async ({
    page,
    homePage,
    scene,
    cmdBar,
    toolbar,
    editor,
  }) => {
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = mm)

myVar = 50
sketch001 = startSketchOn(XZ)
profile001 = circle(sketch001, center = [myVar, 43.9], radius = 41.05)
extrude001 = extrude(profile001, length = 200)
  |> translate(x = 3.14, y = 3.14, z = -50.154)
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [72.2, -52.05])
  |> angledLine(angle = 0deg, length = 181.26, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 21.54)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001), tag = $mySeg)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg01)
  |> close()

extrude002 = extrude(profile002, length = 151)
solid001 = subtract([extrude001], tools = [extrude002])
`
      )
    })

    const [selectChamferFaceClk] = scene.makeMouseHelpers(0.8, 0.5, {
      format: 'ratio',
    })
    const [circleCenterClk] = scene.makeMouseHelpers(0.54, 0.5, {
      format: 'ratio',
    })

    await test.step('Setup', async () => {
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      await scene.moveCameraTo(
        { x: 180, y: -75, z: 116 },
        { x: 67, y: -114, z: -15 }
      )
      await toolbar.waitForFeatureTreeToBeBuilt()
    })

    await test.step('sketch on chamfer face that is part of a boolean', async () => {
      await toolbar.startSketchPlaneSelection()
      await selectChamferFaceClk()

      await expect
        .poll(async () => {
          const lineBtn = page.getByRole('button', { name: 'line Line' })
          return lineBtn.getAttribute('aria-pressed')
        })
        .toBe('true')

      await editor.expectEditor.toContain(
        'startSketchOn(solid001, face = seg01)'
      )
    })

    await test.step('verify sketching still works', async () => {
      await toolbar.circleBtn.click()
      await expect
        .poll(async () => {
          const circleBtn = page.getByRole('button', { name: 'circle Circle' })
          return circleBtn.getAttribute('aria-pressed')
        })
        .toBe('true')

      await circleCenterClk()
      await editor.expectEditor.toContain(
        'profile003 = circle(sketch003, center = ['
      )
    })
  })

  test('Can sketch on face when user defined function was used in the sketch', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    // Checking for a regression that performs a sketch when a user defined function
    // is declared at the top of the file and used in the sketch that is being drawn on.
    // fn in2mm is declared at the top of the file and used rail which does a an extrusion with the function.

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `fn in2mm(@inches) {
    return inches * 25.4
  }

  railTop = in2mm(.748)
  railSide = in2mm(.024)
  railBaseWidth = in2mm(.612)
  railWideWidth = in2mm(.835)
  railBaseLength = in2mm(.200)
  railClampable = in2mm(.200)

  rail = startSketchOn(XZ)
    |> startProfile(at = [-railTop / 2, railClampable + railBaseLength])
    |> line(endAbsolute = [
     railTop / 2,
     railClampable + railBaseLength
   ])
    |> line(endAbsolute = [
     railWideWidth / 2,
     railClampable / 2 + railBaseLength
   ], tag = $seg01)
    |> line(endAbsolute = [railTop / 2, railBaseLength])
    |> line(endAbsolute = [railBaseWidth / 2, railBaseLength])
    |> line(endAbsolute = [railBaseWidth / 2, 0])
    |> line(endAbsolute = [-railBaseWidth / 2, 0])
    |> line(endAbsolute = [-railBaseWidth / 2, railBaseLength])
    |> line(endAbsolute = [-railTop / 2, railBaseLength])
    |> line(endAbsolute = [
     -railWideWidth / 2,
     railClampable / 2 + railBaseLength
   ])
    |> line(endAbsolute = [
     -railTop / 2,
     railClampable + railBaseLength
   ])
    |> close()
    |> extrude(length = in2mm(2))`
      )
    })

    const center = { x: 600, y: 250 }
    const rectangleSize = 20
    await homePage.goToModelingScene()

    // Start a sketch
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    // Click the top face of this rail
    await page.mouse.click(center.x, center.y)
    await page.waitForTimeout(1000)

    // Draw a rectangle
    // top left
    await page.mouse.click(center.x - rectangleSize, center.y - rectangleSize)
    await page.waitForTimeout(250)
    // top right
    await page.mouse.click(center.x + rectangleSize, center.y - rectangleSize)
    await page.waitForTimeout(250)

    // bottom right
    await page.mouse.click(center.x + rectangleSize, center.y + rectangleSize)
    await page.waitForTimeout(250)

    // bottom left
    await page.mouse.click(center.x - rectangleSize, center.y + rectangleSize)
    await page.waitForTimeout(250)

    // top left
    await page.mouse.click(center.x - rectangleSize, center.y - rectangleSize)
    await page.waitForTimeout(250)

    // exit sketch
    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    // Check execution is done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()
  })

  test('Can edit a tangentialArc defined by angle and radius', async ({
    page,
    homePage,
    editor,
    toolbar,
    scene,
    cmdBar,
  }) => {
    const viewportSize = { width: 1500, height: 750 }
    await page.setBodyDimensions(viewportSize)

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit=in)
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [-10, -10])
  |> line(end = [20.0, 10.0])
  |> tangentialArc(angle = 60deg, radius=10.0)`
      )
    })

    await homePage.goToModelingScene()
    await toolbar.waitForFeatureTreeToBeBuilt()
    await scene.settled(cmdBar)
    await toolbar.editSketch()
    const [dragToDifferentPoint] = scene.makeDragHelpers(1000, 177, {
      debug: true,
    })
    await dragToDifferentPoint({
      fromPoint: { x: 1400, y: 177 },
    })

    await page.waitForTimeout(200)
    await editor.expectEditor.toContain('tangentialArc(angle = ', {
      shouldNormalise: true,
    })
    await editor.expectEditor.not.toContain(
      'tangentialArc(angle = 60deg, radius=10.0)'
    )
  })

  test('Can delete a single segment line with keyboard', async ({
    page,
    scene,
    homePage,
    cmdBar,
    editor,
    toolbar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = mm)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 25.0)
  |> yLine(length = 5.0)
  |> line(end = [-22.0, 12.0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`
      )
    })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await toolbar.editSketch()

    // Select the third line
    await editor.selectText('line(end = [-22.0, 12.0])')
    await editor.closePane()

    // Delete with backspace
    await page.keyboard.press('Delete')

    // Validate the editor code no longer contains the deleted line
    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> xLine(length = 25.0)
  |> yLine(length = 5.0)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
`,
      { shouldNormalise: true }
    )
  })
})

test.describe('multi-profile sketching', () => {
  test('can enter sketch mode for sketch with no profiles', async ({
    scene,
    toolbar,
    editor,
    cmdBar,
    page,
    homePage,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', 'sketch001 = startSketchOn(XY)')
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    // open feature tree and double click the first sketch
    await (await toolbar.getFeatureTreeOperation('Sketch', 0)).dblclick()
    await page.waitForTimeout(600)

    // click in the scene twice to add a segment
    const [startProfile1] = scene.makeMouseHelpers(658, 140)
    const [segment1Clk] = scene.makeMouseHelpers(701, 200)

    // wait for line to be aria pressed
    await expect
      .poll(async () => toolbar.lineBtn.getAttribute('aria-pressed'))
      .toBe('true')

    await startProfile1()
    await editor.expectEditor.toContain('profile001 = startProfile')
    await segment1Clk()
    await editor.expectEditor.toContain('|> line(end')
  })
  test('can delete all profiles in sketch mode and user can still equip a tool and draw something', async ({
    scene,
    toolbar,
    editor,
    cmdBar,
    page,
    homePage,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at=[0, 0])
  |> angledLine(angle=45deg, length=1in)
  |> angledLine(angle=180deg, length=0.5in)
`
      )
    })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)
    await toolbar.editSketch(0)

    await test.step('delete all profiles', async () => {
      await editor.replaceCode('', 'sketch001 = startSketchOn(XZ)\n')
    })

    await test.step('wait for execution', async () => {
      // TODO: there is a gap between deleting the code and the re-execution during which
      // there seems to be no signal to the system that we are in a "dirty" state awaiting re-execution.
      // Need a better signal to the system (and by extension Playwright) that a re-execution is coming,
      // because if the user (or test) equips a new tool and draws with it in this state, the tool will
      // be unequipped and the code will be half-reset when execution completes.
      // await expect(toolbar.exitSketchBtn).toBeDisabled()
      // await expect(toolbar.exitSketchBtn).toBeEnabled()
      // TODO: the trick above doesn't seem to work anymore, still need a better signal
      await page.waitForTimeout(2000)
    })

    await test.step('equip circle and draw it', async () => {
      await toolbar.circleBtn.click()
      const [circleCenterClick] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })
      const [circlePerimeterClick] = scene.makeMouseHelpers(0.75, 0.75, {
        format: 'ratio',
      })
      await expect(toolbar.circleBtn).toHaveAttribute('aria-pressed', 'true')
      await circleCenterClick()
      await circlePerimeterClick()
      await editor.expectEditor.not.toContain('profile001 = angledLine(')
      await editor.expectEditor.toContain(
        'profile001 = circle(sketch001, center = ['
      )
    })
  })

  test('Can add multiple profiles to a sketch (all tool types)', async ({
    scene,
    toolbar,
    editor,
    page,
    homePage,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', '@settings(defaultLengthUnit = mm)')
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await editor.closePane()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)

    const [startProfile1] = scene.makeMouseHelpers(568, 158)
    const [endLineStartTanArc] = scene.makeMouseHelpers(701, 158)
    const [endArcStartLine] = scene.makeMouseHelpers(765, 210)

    const [startProfile2] = scene.makeMouseHelpers(782, 120)
    const [profile2Point2] = scene.makeMouseHelpers(921, 120)
    const [profile2Point3] = scene.makeMouseHelpers(953, 178)

    const [circle1Center] = scene.makeMouseHelpers(842, 147)
    const [circle1Radius, circle1RadiusMove] = scene.makeMouseHelpers(842, 171)

    const [circle2Center, moveCircle2Center] = scene.makeMouseHelpers(300, 300)
    const [circle2Radius] = scene.makeMouseHelpers(400, 400)

    const [crnRect1point1] = scene.makeMouseHelpers(583, 205)
    const [crnRect1point2] = scene.makeMouseHelpers(618, 320)

    const [crnRect2point1] = scene.makeMouseHelpers(663, 215)
    const [crnRect2point2] = scene.makeMouseHelpers(744, 276)

    const [cntrRect1point1] = scene.makeMouseHelpers(624, 387)
    const [cntrRect1point2] = scene.makeMouseHelpers(676, 355)

    const [cntrRect2point1] = scene.makeMouseHelpers(785, 332)
    const [cntrRect2point2] = scene.makeMouseHelpers(808, 286)

    const [circle3Point1p1, circle3Point1p1Move] = scene.makeMouseHelpers(
      630,
      465
    )
    const [circle3Point1p2, circle3Point1p2Move] = scene.makeMouseHelpers(
      273,
      340
    )
    const [circle3Point1p3, circle3Point1p3Move] = scene.makeMouseHelpers(
      334,
      414
    )

    const [circle3Point2p1, circle3Point2p1Move] = scene.makeMouseHelpers(
      376,
      351
    )
    const [circle3Point2p2, circle3Point2p2Move] = scene.makeMouseHelpers(
      375,
      279
    )
    const [circle3Point2p3, circle3Point2p3Move] = scene.makeMouseHelpers(
      334,
      306
    )

    await toolbar.startSketchPlaneSelection()
    await selectXZPlane()
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)
    await editor.expectEditor.toContain('sketch001 = startSketchOn(XZ)')
    await test.step('Create a close profile stopping mid profile to equip the tangential arc, then three-point arc, and then back to the line tool', async () => {
      await startProfile1()
      await editor.expectEditor.toContain('profile001 = startProfile(')

      await endLineStartTanArc()

      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile001 = startProfile.*\|> xLine/
      )

      await toolbar.selectTangentialArc()
      await page.waitForTimeout(300)
      // Purposefully click in a bad spot to see the tan arc warning
      await page.mouse.click(745, 359)
      await page.waitForTimeout(300)
      await endLineStartTanArc({ delay: 544 })

      await page.waitForTimeout(100)
      await endArcStartLine()

      await page.waitForTimeout(100)
      await editor.expectEditor.toContain(
        /profile001 = startProfile.*\|> xLine.*\|> tangentialArc/
      )

      // Add a three-point arc segment
      await toolbar.selectThreePointArc()
      await page.waitForTimeout(300)

      // select end of profile again
      await endArcStartLine()
      await page.waitForTimeout(300)

      // Define points for the three-point arc
      const [threePointInterior, threePointInteriorMove] =
        scene.makeMouseHelpers(600, 200)
      const [threePointEnd, threePointEndMove] = scene.makeMouseHelpers(
        590,
        270
      )

      // Create the three-point arc
      await page.waitForTimeout(300)
      await threePointInteriorMove()
      await threePointInterior()
      await page.waitForTimeout(300)
      await threePointEndMove()
      await threePointEnd()
      await page.waitForTimeout(300)

      // Verify the three-point arc was created correctly
      await editor.expectEditor.toContain('arc(')
      await editor.expectEditor.toContain('interiorAbsolute')

      // Switch back to line tool to continue
      await toolbar.lineBtn.click()
      await page.waitForTimeout(300)

      // Continue with the original line segment
      await threePointEnd()
      await page.waitForTimeout(300)

      const [lineSegmentClick] = scene.makeMouseHelpers(572, 110)
      await lineSegmentClick()

      await editor.expectEditor.toContain(/arc\(.*\|> line\(/)

      await page.waitForTimeout(300)
      await startProfile1()

      await editor.expectEditor.toContain(
        `|> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`,
        { shouldNormalise: true }
      )
      await page.waitForTimeout(300)
    })

    await test.step('Without unequipping from the last step, make another profile, and one that is not closed', async () => {
      await startProfile2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(/profile002 = startProfile/)
      await profile2Point2()
      await page.waitForTimeout(300)

      await editor.expectEditor.toContain(
        /profile002 = startProfile.*\|> xLine/
      )
      await profile2Point3()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile002 = startProfile.*\|> xLine.*\|> line/
      )
    })

    await test.step('create two circles in a row without unequip', async () => {
      await toolbar.circleBtn.click()

      await page.waitForTimeout(300)
      await circle1Center()
      await page.waitForTimeout(300)
      await circle1RadiusMove()
      await circle1Radius({ delay: 500 })
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(/profile003 = circle\(sketch001/)

      await test.step('hover in empty space to wait for overlays to get out of the way', async () => {
        await scene.moveNoWhere()
        await page.waitForTimeout(1000)
      })

      await moveCircle2Center()
      await circle2Center({ delay: 50 })
      await page.waitForTimeout(300)

      await circle2Radius()
      await editor.expectEditor.toContain(/profile004 = circle\(sketch001/)
      await page.waitForTimeout(300)
    })

    await test.step('create two corner rectangles in a row without unequip', async () => {
      await toolbar.rectangleBtn.click()
      await expect(toolbar.rectangleBtn).toHaveAttribute('aria-pressed', 'true')
      await page.waitForTimeout(300)

      await crnRect1point1()

      await editor.expectEditor.toContain(
        /profile005 = startProfile\(sketch001/
      )
      await editor.closePane()

      await page.waitForTimeout(300)
      await crnRect1point2()
      await editor.expectEditor.toContain(
        /profile005 = startProfile.*angledLine.*angledLine.*angledLine.*line.*close/
      )

      await crnRect2point1()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(/profile006 = startProfile/)
      await crnRect2point2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile006 = startProfile.*angledLine.*angledLine.*angledLine.*line.*close/
      )
    })

    await test.step('create two center rectangles in a row without unequip', async () => {
      await toolbar.selectCenterRectangle()
      await page.waitForTimeout(300)

      await cntrRect1point1()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(/profile007 = startProfile/)
      await editor.closePane()
      await cntrRect1point2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile007 = startProfile.*angledLine.*angledLine.*angledLine.*line.*close/
      )
      await page.waitForTimeout(300)

      await cntrRect2point1()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(/profile008 = startProfile/)
      await editor.closePane()
      await cntrRect2point2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile008 = startProfile.*angledLine.*angledLine.*angledLine.*line.*close/
      )
    })

    await test.step('create two circle-three-points in a row without an unequip', async () => {
      await toolbar.selectCircleThreePoint()

      await circle3Point1p1Move()
      await circle3Point1p1()
      await page.waitForTimeout(300)
      await circle3Point1p2Move()
      await circle3Point1p2()
      await page.waitForTimeout(300)
      await circle3Point1p3Move()
      await circle3Point1p3()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile009 = circleThreePoint\(\s*sketch001/
      )

      await circle3Point2p1Move()
      await circle3Point2p1()
      await page.waitForTimeout(300)
      await circle3Point2p2Move()
      await circle3Point2p2()
      await page.waitForTimeout(300)
      await circle3Point2p3Move()
      await circle3Point2p3()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile010 = circleThreePoint\(\s*sketch001/
      )
    })

    await test.step('create three-point arcs in a row without an unequip', async () => {
      // Define points for the first three-point arc
      const [arc1Point1, arc1Point1Move] = scene.makeMouseHelpers(700, 397)
      const [arc1Point2, arc1Point2Move] = scene.makeMouseHelpers(724, 346)
      const [arc1Point3, arc1Point3Move] = scene.makeMouseHelpers(785, 415)

      // Define points for the second three-point arc
      const [arc2Point1, arc2Point1Move] = scene.makeMouseHelpers(792, 225)
      const [arc2Point2, arc2Point2Move] = scene.makeMouseHelpers(820, 207)
      const [arc2Point3, arc2Point3Move] = scene.makeMouseHelpers(905, 229)

      // Select the three-point arc tool
      await toolbar.selectThreePointArc()

      // Create the first three-point arc
      await arc1Point1Move()
      await arc1Point1()
      await page.waitForTimeout(300)
      await arc1Point2Move()
      await arc1Point2()
      await page.waitForTimeout(300)
      await arc1Point3Move()
      await arc1Point3()
      await page.waitForTimeout(300)

      // Verify the first three-point arc was created correctly
      await editor.expectEditor.toContain(
        /profile011 = startProfile.*arc\(interiorAbsolute/
      )

      // Create the second three-point arc
      await arc2Point1Move()
      await arc2Point1()
      await page.waitForTimeout(300)
      await arc2Point2Move()
      await arc2Point2()
      await page.waitForTimeout(300)
      await arc2Point3Move()
      await arc2Point3()
      await page.waitForTimeout(300)

      // Verify the second three-point arc was created correctly
      await editor.expectEditor.toContain(
        /profile011 = startProfile.*arc\(interiorAbsolute.*arc\(interiorAbsolute/
      )
    })

    await test.step('double check that three-point arc can be unequipped', async () => {
      // this was tested implicitly for other tools, but not for three-point arc since it's last
      await page.waitForTimeout(300)
      await toolbar.lineBtn.click()
      await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')
    })
  })

  test('can enter sketch when there is an extrude', async ({
    homePage,
    scene,
    toolbar,
    page,
    cmdBar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-63.43, 193.08])
  |> line(end = [168.52, 149.87])
  |> line(end = [190.29, -39.18])
  |> tangentialArc(endAbsolute = [319.63, 129.65])
  |> line(end = [-217.65, -21.76])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile003 = startProfile(sketch001, at = [16.79, 38.24])
  |> angledLine(angle = 0deg, length = 182.82, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 105.71)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile004 = circle(
  sketch001,
  center = [280.45, 47.57],
  radius = 55.26
)
extrude002 = extrude(profile001, length = 50)
extrude001 = extrude(profile003, length = 5)
`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)
    await expect(toolbar.startSketchBtn).not.toBeDisabled()

    await toolbar.editSketch()
    await expect(toolbar.exitSketchBtn).toBeVisible()
    await expect(toolbar.exitSketchBtn).not.toBeDisabled()
  })

  test('exit new sketch without drawing anything should not be a problem', async ({
    homePage,
    scene,
    toolbar,
    editor,
    cmdBar,
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
        myVar = 5`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await toolbar.openFeatureTreePane()
    await toolbar.startSketchPlaneSelection()
    await page.getByRole('button', { name: 'Front plane' }).click()

    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)

    await editor.expectEditor.toContain(`sketch001 = startSketchOn(XZ)`)
    await toolbar.exitSketch()

    await editor.expectEditor.not.toContain(`sketch001 = startSketchOn(XZ)`)

    await test.step("still renders code, hasn't got into a weird state", async () => {
      await editor.replaceCode(
        'myVar = 5',
        `myVar = 5
  sketch001 = startSketchOn(XZ)
  profile001 = circle(
    sketch001,
    center = [12.41, 3.87],
    radius = myVar
  )`
      )

      await editor.closePane()
      await scene.settled(cmdBar)
      await toolbar.openFeatureTreePane()
      await expect(
        await toolbar.getFeatureTreeOperation('Sketch', 0)
      ).toBeVisible()
    })
  })
  test('A sketch with only "startProfileAt" and no segments should still be able to be continued', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
    cmdBar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [85.19, 338.59])
  |> line(end = [213.3, -94.52])
  |> line(end = [-230.09, -55.34])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [0, 52.55])
`
      )
    })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const [startProfileAt] = scene.makeMouseHelpers(606, 184)
    const [nextPoint] = scene.makeMouseHelpers(763, 130)
    await page.getByText('startProfile(sketch002').click()
    await toolbar.editSketch(1)
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)
    await editor.closePane()

    // equip line tool
    await toolbar.lineBtn.click()
    await startProfileAt()
    await nextPoint()
    await editor.openPane()
    // A regex that just confirms the new segment is a line in a pipe
    await expect(editor.codeContent).toContainText(/52\.55\]\)\s+\|\>\s+line\(/)
  })
  test('old style sketch all in one pipe (with extrude) will break up to allow users to add a new profile to the same sketch', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
    cmdBar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
thePart = startSketchOn(XZ)
  |> startProfile(at = [7.53, 10.51])
  |> line(end = [12.54, 1.83])
  |> line(end = [6.65, -6.91])
  |> line(end = [-6.31, -8.69])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(thePart, length = 75)
`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const [objClick] = scene.makeMouseHelpers(565, 343)
    const [profilePoint1] = scene.makeMouseHelpers(609, 289)
    const [profilePoint2] = scene.makeMouseHelpers(714, 389)

    await test.step('enter sketch and setup', async () => {
      await objClick()
      await toolbar.editSketch()
    })

    await test.step('expect code to match initial conditions still', async () => {
      await editor.expectEditor.toContain(
        `thePart = startSketchOn(XZ)  |> startProfile(at = [`
      )
      await expect(toolbar.lineBtn).not.toHaveAttribute('aria-pressed', 'true')
    })

    await test.step('equiping the line tool should break up the pipe expression', async () => {
      await toolbar.lineBtn.click()
      await editor.expectEditor.toContain(
        `sketch001 = startSketchOn(XZ)thePart = startProfile(sketch001, at = [`
      )
    })

    await test.step('can continue on to add a new profile to this sketch', async () => {
      await profilePoint1()
      await editor.expectEditor.toContain(
        `profile001 = startProfile(sketch001, at = [`
      )
      await profilePoint2()

      const profileWithLineRegExp = new RegExp(
        `profile001 = startProfile\\(sketch001, at = \\[${NUMBER_REGEXP}, ${NUMBER_REGEXP}\\]\\)\\s+\\|> line\\(end`
      )
      await editor.expectEditor.toContain(profileWithLineRegExp)
    })
  })
  test('Can enter sketch on sketch of wall and cap for segment, solid2d, extrude-wall, extrude-cap selections', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
    cmdBar,
  }) => {
    // TODO this test should include a test for selecting revolve walls and caps

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [6.71, -3.66])
  |> line(end = [2.65, 9.02], tag = $seg02)
  |> line(end = [3.73, -9.36], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 20)
sketch002 = startSketchOn(extrude001, face = seg01)
profile002 = startProfile(sketch002, at = [0.75, 13.46])
  |> line(end = [4.52, 3.79])
  |> line(end = [5.98, -2.81])
profile003 = startProfile(sketch002, at = [3.19, 13.3])
  |> angledLine(angle = 0deg, length = 6.64, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 2.81)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile004 = startProfile(sketch002, at = [3.15, 9.39])
  |> xLine(length = 6.92)
  |> line(end = [-7.41, -2.85])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile005 = circle(sketch002, center = [5.15, 4.34], radius = 1.66)
profile006 = startProfile(sketch002, at = [9.65, 3.82])
  |> line(end = [2.38, 5.62])
  |> line(end = [2.13, -5.57])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile004,
  angle = 45deg,
  axis = getNextAdjacentEdge(seg01)
)
extrude002 = extrude(profile006, length = 4)
sketch003 = startSketchOn(-XZ)
profile007 = startProfile(sketch003, at = [4.8, 7.55])
  |> line(end = [7.39, 2.58])
  |> line(end = [7.02, -2.85])
profile008 = startProfile(sketch003, at = [5.54, 5.49])
  |> line(end = [6.34, 2.64])
  |> line(end = [6.33, -2.96])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile009 = startProfile(sketch003, at = [5.23, 1.95])
  |> line(end = [6.8, 2.17])
  |> line(end = [7.34, -2.75])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile010 = circle(
  sketch003,
  center = [7.18, -2.11],
  radius = 2.67
)
profile011 = startProfile(sketch003, at = [5.07, -6.39])
  |> angledLine(angle = 0deg, length = 4.54, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) - 90deg, length = 4.17)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude003 = extrude(profile011, length = 2.5)
// TODO this breaks the test,
// revolve002 = revolve(profile008, angle = 45deg, axis = seg02)
`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await toolbar.closePane('code')
    await scene.settled(cmdBar)

    const camPositionForSelectingSketchOnWallProfiles = () =>
      scene.moveCameraTo(
        { x: 834, y: -680, z: 534 },
        { x: -54, y: -476, z: 148 }
      )
    const wallSelectionOptions = [
      {
        title: 'select wall solid 2d',
        selectClick: scene.makeMouseHelpers(677, 236)[0],
      },
      {
        title: 'select wall circle',
        selectClick: scene.makeMouseHelpers(811, 247)[0],
      },
      // TODO: enable this once double click to edit sketch on face works
      // {
      //   title: 'select wall extrude wall',
      //   selectClick: scene.makeMouseHelpers(793, 136)[0],
      // },
      // {
      //   title: 'select wall extrude cap',
      //   selectClick: scene.makeMouseHelpers(836, 103)[0],
      // },
    ] as const

    await test.step('select wall profiles', async () => {
      for (const { title, selectClick } of wallSelectionOptions) {
        await test.step(title, async () => {
          await camPositionForSelectingSketchOnWallProfiles()
          await selectClick({ shouldDbClick: true })
          await page.waitForTimeout(6000)
          await toolbar.expectToolbarMode.toBe('sketching')
          await expect(page.getByTestId('segment-overlay')).toHaveCount(14)
          await toolbar.exitSketchBtn.click()
          await page.waitForTimeout(100)
        })
      }
    })

    /* FIXME: the cap part of this test is insanely flaky, and I'm not sure
     * why.
     * await test.step('select cap profiles', async () => {
      for (const { title, selectClick } of capSelectionOptions) {
        await test.step(title, async () => {
          await camPositionForSelectingSketchOnCapProfiles()
          await page.waitForTimeout(100)
          await selectClick()
          await toolbar.editSketch()
          await page.waitForTimeout(600)
          await verifyCapProfilesAreDrawn()
          await toolbar.exitSketchBtn.click()
          await page.waitForTimeout(100)
        })
      }
    }) */
  })
  test('Can enter sketch loft edges, base and continue sketch', async ({
    homePage,
    scene,
    toolbar,
    cmdBar,
    editor,
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [34, 42.66])
  |> line(end = [102.65, 151.99])
  |> line(end = [76, -138.66])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
plane001 = offsetPlane(XZ, offset = 50)
sketch002 = startSketchOn(plane001)
profile002 = startProfile(sketch002, at = [39.43, 172.21])
  |> xLine(length = 183.99)
  |> line(end = [-77.95, -145.93])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

loft([profile001, profile002])
`
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 800 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const [rect1Crn1] = scene.makeMouseHelpers(0.6, 0.5, { format: 'ratio' })
    const [rect1Crn2] = scene.makeMouseHelpers(0.8, 0.7, { format: 'ratio' })

    await toolbar.editSketch()
    await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
    await toolbar.rectangleBtn.click()
    await page.waitForTimeout(100)
    await rect1Crn1()
    await rect1Crn2()
    await editor.expectEditor.toContain(`profile003 = startProfile(sketch001`)
    await editor.expectEditor.toContain(`tag = $rectangleSegmentA001)`)
    await expect(page.getByTestId('segment-overlay')).toHaveCount(9)
  })
})

// Regression test for https://github.com/KittyCAD/modeling-app/issues/4372
test.describe('Redirecting to home page and back to the original file should clear sketch DOM elements', () => {
  test('Can redirect to home page and back to original file and have a cleared DOM', async ({
    context,
    page,
    scene,
    toolbar,
    editor,
    homePage,
    cmdBar,
  }) => {
    // We seed the scene with a single offset plane
    await context.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        ` sketch001 = startSketchOn(XZ)
|> startProfile(at = [256.85, 14.41])
|> line(endAbsolute = [0, 211.07])
`
      )
    })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const [objClick] = scene.makeMouseHelpers(634, 274)
    await objClick()

    // Enter sketch mode
    await toolbar.editSketch()

    await expect(page.getByText('323.49')).toBeVisible()

    // Open navigation side bar
    await page.getByTestId('project-sidebar-toggle').click()
    const goToHome = page.getByRole('button', {
      name: 'Go to Home',
    })

    await goToHome.click()
    await homePage.openProject('testDefault')
    await expect(page.getByText('323.49')).not.toBeVisible()
  })

  test('Straight line snapping to previous tangent', async ({
    page,
    homePage,
    toolbar,
    scene,
    cmdBar,
    context,
    editor,
  }) => {
    await context.addInitScript(() => {
      localStorage.setItem('persistCode', `@settings(defaultLengthUnit = mm)`)
    })

    const viewportSize = { width: 1200, height: 900 }
    await page.setBodyDimensions(viewportSize)
    await homePage.goToModelingScene()

    // wait until scene is ready to be interacted with
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    await page.getByRole('button', { name: 'Start Sketch' }).click()

    // select an axis plane
    const [selectPlane] = scene.makeMouseHelpers(0.6, 0.3, { format: 'ratio' })
    await selectPlane()

    // Needed as we don't yet have a way to get a signal from the engine that the camera has animated to the sketch plane
    await page.waitForTimeout(3000)

    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 }
    const { click00r } = getMovementUtils({ center, page })

    // Draw line
    await click00r(0, 0)
    await click00r(200, -200)

    // Draw arc
    await toolbar.selectTangentialArc()
    await click00r(0, 0)
    await click00r(100, 100)

    // Switch back to line
    await toolbar.selectLine()
    await click00r(0, 0)
    await click00r(-100, 100)

    // Draw a 3 point arc
    await toolbar.selectThreePointArc()
    await click00r(0, 0)
    await click00r(0, 100)
    await click00r(100, 0)

    // draw a line to opposite tangent direction of previous arc
    await toolbar.selectLine()
    await click00r(0, 0)
    await click00r(-200, 200)

    // Check for tangent-related parts only
    await editor.expectEditor.toContain('tangentialArc')
    await editor.expectEditor.toContain('tangentToEnd(seg01)')
    await editor.expectEditor.toContain(
      'tangentToEnd(seg02) + turns::HALF_TURN'
    )
  })
})

test.describe('manual edits during sketch mode', () => {
  test('Will exit out of sketch mode when all code is nuked', async ({
    page,
    context,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    const initialCode = `myVar1 = 5
    myVar2 = 6

    sketch001 = startSketchOn(XZ)
    profile001 = startProfile(sketch001, at = [106.68, 89.77])
      |> line(end = [132.34, 157.8])
      |> line(end = [67.65, -460.55], tag = $seg01)
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    extrude001 = extrude(profile001, length = 500)
    sketch002 = startSketchOn(extrude001, face = seg01)
    profile002 = startProfile(sketch002, at = [83.39, 329.15])
      |> angledLine(angle = 0deg, length = 119.61, tag = $rectangleSegmentA001)
      |> angledLine(length = 156.54, angle = -28deg)
      |> angledLine(
           angle = -151deg,
           length = 116.27,
         )
      |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
      |> close()
    profile003 = startProfile(sketch002, at = [-201.08, 254.17])
      |> line(end = [103.55, 33.32])
      |> line(end = [48.8, -153.54])`

    await context.addInitScript((initialCode) => {
      localStorage.setItem('persistCode', initialCode)
    }, initialCode)

    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    await test.step('Open feature tree and edit second sketch', async () => {
      await toolbar.editSketch(1)
    })

    await test.step('clear editor content while in sketch mode', async () => {
      await editor.replaceCode('', '')
      await page.waitForTimeout(100)
      await expect(
        page.getByText('Unable to maintain sketch mode')
      ).toBeVisible()
      await expect(toolbar.exitSketchBtn).not.toBeVisible()
      await expect(toolbar.startSketchBtn).toBeVisible()
    })
  })
  test('empty draft sketch is cleaned up properly', async ({
    scene,
    toolbar,
    cmdBar,
    page,
    homePage,
  }) => {
    // This is the sketch used in the original report, but any sketch would work
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `yRel002 = 200
lStraight = -200
yRel001 = -lStraight
length001 = lStraight
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-102.72, 237.44])
  |> yLine(length = lStraight)
  |> tangentialArc(endAbsolute = [118.9, 23.57])
  |> line(end = [-17.64, yRel002])
`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    // Ensure start sketch button is enabled
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    // Start a new sketch
    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)
    await toolbar.startSketchPlaneSelection()
    await selectXZPlane()
    await page.waitForTimeout(2000) // wait for engine animation

    // Switch to a different tool (circle)
    await toolbar.circleBtn.click()
    await expect(toolbar.circleBtn).toHaveAttribute('aria-pressed', 'true')

    // Exit the empty sketch
    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    // Ensure the feature tree now shows only one sketch
    await toolbar.openFeatureTreePane()
    await expect(
      toolbar.featureTreePane.getByRole('button', { name: 'Sketch' })
    ).toHaveCount(1)
    await toolbar.closeFeatureTreePane()

    // Open the first sketch from the feature tree (the existing sketch)
    await (await toolbar.getFeatureTreeOperation('Sketch', 0)).dblclick()
    // timeout is a bit longer because when the bug happened, it did go into sketch mode for a split second, but returned
    // automatically, we want to make sure it stays there.
    await page.waitForTimeout(2000)

    // Validate we are in sketch mode (Exit Sketch button visible)
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()
  })

  // Ensure feature tree is not showing previous file's content when switching to a file with KCL errors.
  test('Feature tree shows correct sketch count per file', async ({
    context,
    homePage,
    scene,
    toolbar,
    cmdBar,
    page,
  }) => {
    const u = await getUtils(page)

    // Setup project with files.
    const GOOD_KCL = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [220.81, 253.8])
  |> line(end = [132.84, -151.31])
  |> line(end = [25.51, 167.15])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [158.35, -70.82])
  |> line(end = [73.9, -152.19])
  |> line(end = [85.33, 135.48])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`

    const ERROR_KCL = `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [127.56, 179.02])
  |> line(end = [132.84, -112.6])
  |> line(end = [85.33, 234.01])
  |> line(enfd = [-137.23, -54.55])`

    await context.folderSetupFn(async (dir) => {
      const projectDir = path.join(dir, 'multi-file-sketch-test')
      await fs.mkdir(projectDir, { recursive: true })
      await Promise.all([
        fs.writeFile(path.join(projectDir, 'good.kcl'), GOOD_KCL, 'utf-8'),
        fs.writeFile(path.join(projectDir, 'error.kcl'), ERROR_KCL, 'utf-8'),
      ])
    })

    await page.setBodyDimensions({ width: 1000, height: 800 })

    await homePage.openProject('multi-file-sketch-test')
    await scene.connectionEstablished()

    await u.closeDebugPanel()

    await toolbar.openFeatureTreePane()
    await toolbar.openPane('files')

    await toolbar.openFile('good.kcl')

    await expect(
      toolbar.featureTreePane.getByRole('button', { name: 'Sketch' })
    ).toHaveCount(2)

    await toolbar.openFile('error.kcl')

    await expect(
      toolbar.featureTreePane.getByRole('button', { name: 'Sketch' })
    ).toHaveCount(0)
  })
})
