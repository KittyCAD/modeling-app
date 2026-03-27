import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import { settingsToToml } from '@e2e/playwright/test-utils'
import { TEST_SETTINGS, TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'

/**
 * Extract a specific line from code string (1-based line number).
 * Trims whitespace from the line.
 */
function getCodeLine({ code, line }: { code: string; line: number }): string {
  const lines = code.split('\n')
  if (line < 0 || line > lines.length) {
    throw new Error(`Line ${line} is out of range (1-${lines.length})`)
  }
  return lines[line].trim()
}

/**
 * Wait for the editor code to change from the previous code.
 * Returns the new code content after it has changed.
 */
async function waitForCodeChange(
  page: Page,
  previousCode: string
): Promise<string> {
  await expect(page.locator('.cm-content')).not.toHaveText(previousCode)
  return await page.locator('.cm-content').innerText()
}

/**
 * Get the midpoint coordinates between two segment IDs.
 * Returns an object with x and y coordinates.
 */
async function getMidpointBetweenSegments(
  scene: SceneFixture,
  id1: string,
  id2: string
): Promise<{ x: number; y: number }> {
  const box1 = await scene.getBoundingBoxOrThrow(`[data-segment_id="${id1}"]`)
  const box2 = await scene.getBoundingBoxOrThrow(`[data-segment_id="${id2}"]`)

  const center1X = box1.x + box1.width / 2
  const center1Y = box1.y + box1.height / 2
  const center2X = box2.x + box2.width / 2
  const center2Y = box2.y + box2.height / 2

  return {
    x: (center1X + center2X) / 2,
    y: (center1Y + center2Y) / 2,
  }
}

/**
 * Click a segment by using its DOM element's position
 * The CSS2DObjects have been made invisible but they are kept for these tests.
 * Clicking on the DOM element directly was flaky.
 */
async function clickSegmentById(
  page: Page,
  scene: SceneFixture,
  segmentId: string
) {
  const box = await scene.getBoundingBoxOrThrow(
    `[data-segment_id="${segmentId}"]`
  )
  await page.mouse.click(box.x, box.y) // box size is 1x1 px so we can ignore width, height
}

const TEST_CODE = `@settings(experimentalFeatures = allow)

mySketch = startSketchOn(XZ)
myProfile = startProfile(mySketch, at = [0, 1])
  |> line(end = [-2.5, 3.75])
sketch(on = XZ) {
  line(start = [var -0.88mm, var 0.54mm], end = [var 0.63mm, var 1.18mm])
  line(start = [var 0.85mm, var -0.57mm], end = [var -0.21mm, var 1.55mm])
  line(start = [var -1.59mm, var -0.49mm], end = [var 0.09mm, var -0.56mm])
  point(at = [var -1.44mm, var 1.16mm])
  point(at = [var -0.41mm, var 0.26mm])
  point(at = [var -0.36mm, var -1.23mm])
}
`

test.describe('Sketch solve edit tests', { tag: '@desktop' }, () => {
  test("can edit an existing sketch and edit it's segments", async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
  }) => {
    await test.step('Set up the app with test code', async () => {
      await context.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, TEST_CODE)

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      await editor.expectEditor.toContain('sketch(on = XZ)')
    })

    await test.step('Place cursor in sketch block and verify Edit Sketch button', async () => {
      await editor.scrollToText('line(start = [var -0.88mm, var 0.54mm]')
      await page.getByText('line(start = [var -0.88mm, var 0.54mm]').click()

      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeVisible()
    })

    await test.step('Open feature tree and enter sketch edit mode', async () => {
      await toolbar.openFeatureTreePane()
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })

      const solveSketchOperation = await toolbar.getFeatureTreeOperation(
        'Solve Sketch',
        0
      )
      await solveSketchOperation.dblclick()

      await page.waitForTimeout(600)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
    })

    await test.step('Verify point handles are visible', async () => {
      const pointHandles = page.locator('[data-handle="sketch-point-handle"]')
      await expect(pointHandles).toHaveCount(9)
    })

    await test.step('Drag point segment 13 down', async () => {
      const segmentBox = await scene.getBoundingBoxOrThrow(
        '[data-segment_id="14"]'
      )

      const centerX = segmentBox.x + segmentBox.width / 2
      const centerY = segmentBox.y + segmentBox.height / 2

      const lineToEdit = getCodeLine({ code: TEST_CODE, line: 11 })
      await editor.expectEditor.toContain(lineToEdit)

      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await page.mouse.move(centerX, centerY + 50, { steps: 5 })
      await page.mouse.up()

      await page.waitForTimeout(500)

      await editor.expectEditor.not.toContain(lineToEdit)
    })

    await test.step('Drag line segment by dragging midpoint between points 8 and 9 down', async () => {
      const midpoint = await getMidpointBetweenSegments(scene, '9', '10')

      const lineToEdit = getCodeLine({ code: TEST_CODE, line: 8 })
      await editor.expectEditor.toContain(lineToEdit)

      await page.mouse.move(midpoint.x, midpoint.y)
      await page.mouse.down()
      await page.mouse.move(midpoint.x, midpoint.y + 50, { steps: 5 })
      await page.mouse.up()

      await page.waitForTimeout(500)

      await editor.expectEditor.not.toContain(lineToEdit)
    })
  })

  test('add new sketch, add segments and verify a constraint can be added', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
    tronApp,
  }) => {
    const INITIAL_CODE = `@settings(experimentalFeatures = allow)
`
    const pointHandles = page.locator('[data-handle="sketch-point-handle"]')

    await test.step('Set up the app with initial code and enable sketch solve mode', async () => {
      // Set useSketchSolveMode in user settings (it's stored at user level even though hideOnLevel is 'project')
      // This ensures it's available immediately when the app loads, regardless of IS_STAGING_OR_DEBUG
      if (tronApp) {
        // Electron: settings via file system using cleanProjectDir
        await tronApp.cleanProjectDir({
          modeling: {
            use_sketch_solve_mode: true,
          },
        })
      }
      const userSettingsToml = settingsToToml({
        settings: {
          ...TEST_SETTINGS,
          modeling: {
            ...TEST_SETTINGS.modeling,
            use_sketch_solve_mode: true,
          },
        },
      })

      await context.addInitScript(
        async ({ code, settingsKey, settingsToml }) => {
          localStorage.setItem('persistCode', code)
          // Set useSketchSolveMode in user settings
          if (settingsToml) {
            localStorage.setItem(settingsKey, settingsToml)
          }
        },
        {
          code: INITIAL_CODE,
          settingsKey: TEST_SETTINGS_KEY,
          settingsToml: userSettingsToml,
        }
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Start a new sketch and select a plane', async () => {
      await toolbar.startSketchOnDefaultPlane('Top plane')
      await editor.expectEditor.toContain('sketch(on = XY) {')
    })

    await test.step('Add three line segments', async () => {
      await toolbar.lineBtn.click()
      await page.waitForTimeout(200) // Brief wait for tool to be active

      let previousCode = await editor.getCurrentCode()

      const cancelLineChaining = async () => {
        await page.waitForTimeout(60)
        return page.keyboard.press('Escape')
      }
      // First line segment
      const [line1Start] = scene.makeMouseHelpers(0.3, 0.4, {
        format: 'ratio',
      })
      const [line1End] = scene.makeMouseHelpers(0.3, 0.8, {
        format: 'ratio',
      })
      await line1Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line1End()
      previousCode = await waitForCodeChange(page, previousCode)
      await cancelLineChaining()
      previousCode = await waitForCodeChange(page, previousCode)
      await expect(pointHandles).toHaveCount(2)

      // Second line segment
      const [line2Start] = scene.makeMouseHelpers(0.5, 0.4, {
        format: 'ratio',
      })
      const [line2End] = scene.makeMouseHelpers(0.8, 0.3, {
        format: 'ratio',
      })
      await line2Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line2End()
      previousCode = await waitForCodeChange(page, previousCode)
      await cancelLineChaining()
      previousCode = await waitForCodeChange(page, previousCode)
      await expect(pointHandles).toHaveCount(4)

      // Third line segment
      const [line3Start] = scene.makeMouseHelpers(0.7, 0.4, {
        format: 'ratio',
      })
      const [line3End] = scene.makeMouseHelpers(0.15, 0.3, {
        format: 'ratio',
      })
      await line3Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line3End()
      previousCode = await waitForCodeChange(page, previousCode)
      await cancelLineChaining()
      await waitForCodeChange(page, previousCode)
      await expect(pointHandles).toHaveCount(6)
    })

    await test.step('Add three points', async () => {
      await page.getByTestId('point').click()

      let previousCode = await editor.getCurrentCode()

      // First point
      const [point1Click] = scene.makeMouseHelpers(0.2, 0.6, {
        format: 'ratio',
      })
      await point1Click()
      previousCode = await waitForCodeChange(page, previousCode)

      // Second point
      const [point2Click] = scene.makeMouseHelpers(0.5, 0.6, {
        format: 'ratio',
      })
      await point2Click()
      previousCode = await waitForCodeChange(page, previousCode)

      // Third point
      const [point3Click] = scene.makeMouseHelpers(0.6, 0.6, {
        format: 'ratio',
      })
      await point3Click()
      await waitForCodeChange(page, previousCode)
      await page.getByTestId('point').click()
    })

    await test.step('Select segments 2 and 9, then apply coincident constraint', async () => {
      await clickSegmentById(page, scene, '2')
      // await page.waitForTimeout(100)
      await clickSegmentById(page, scene, '9')
      // await page.waitForTimeout(100)

      // Click the coincident tool
      await page.getByTestId('coincident').click()

      await editor.expectEditor.toContain(
        'coincident([line1.start, line3.end])'
      )
      await page.waitForTimeout(100)
    })
    const [clearSelection] = scene.makeMouseHelpers(0.5, 0.5, {
      format: 'ratio',
    })
    await test.step('Select lines between segments 2-3 and 5-6, then apply parallel constraint', async () => {
      await clearSelection()
      const segmentBox = await scene.getBoundingBoxOrThrow(
        '[data-segment_id="2"]'
      )
      const centerX = segmentBox.x + segmentBox.width / 2
      const centerY = segmentBox.y + segmentBox.height / 2
      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await page.mouse.move(centerX + 200, centerY + 0, { steps: 5 })
      await page.mouse.up()
    })

    await test.step('Select lines between segments 2-3 and 5-6, then apply parallel constraint', async () => {
      // Click in dead space to clear selections
      const midpoint1_2 = await getMidpointBetweenSegments(scene, '2', '3')
      const midpoint4_5 = await getMidpointBetweenSegments(scene, '5', '6')

      await clearSelection()
      // await page.waitForTimeout(100)
      await page.mouse.click(midpoint1_2.x, midpoint1_2.y)
      // await page.waitForTimeout(100)
      await page.mouse.click(midpoint4_5.x, midpoint4_5.y)
      // await page.waitForTimeout(100)

      // Click the parallel tool
      // await page.waitForTimeout(100)
      await page.getByTestId('Parallel').click()

      await editor.expectEditor.toContain('parallel([line1, line2])')
    })

    await test.step('Create a circle in sketch solve mode and verify code updates', async () => {
      await toolbar.circleBtn.click()
      await expect(toolbar.circleBtn).toHaveAttribute('aria-pressed', 'true')

      let previousCode = await editor.getCurrentCode()
      const [circleCenterClick] = scene.makeMouseHelpers(0.75, 0.65, {
        format: 'ratio',
      })
      const [circleRadiusClick] = scene.makeMouseHelpers(0.85, 0.78, {
        format: 'ratio',
      })

      await circleCenterClick()
      previousCode = await waitForCodeChange(page, previousCode)
      await circleRadiusClick()
      await waitForCodeChange(page, previousCode)

      await editor.expectEditor.toContain('circle(start = [')
      await expect(pointHandles).toHaveCount(11)
    })
  })

  test('can delete individual constraints and the sketch block from the feature tree', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
  }) => {
    await test.step('Set up the app with test code', async () => {
      const code = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -3.58mm, var 3.79mm], end = [var 6.18mm, var 5.34mm])
  horizontal(line1)
  line2 = line(start = [var 6.79mm, var 3.56mm], end = [var 6.5mm, var -2.56mm])
  coincident([line2.start, line1.end])
}`
      await context.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, code)
      await page.setBodyDimensions({ width: 1200, height: 1000 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('sketch(on')
      await toolbar.openFeatureTreePane()
    })

    // TODO: figure out why this is needed for frontend's deleteObjects to work
    await test.step('Enter sketch edit mode and exit it', async () => {
      await expect(page.getByText('Building feature tree')).not.toBeVisible({
        timeout: 10000,
      })
      const solveSketchOperation = await toolbar.getFeatureTreeOperation(
        'sketch001',
        0
      )
      await solveSketchOperation.dblclick()
      await page.waitForTimeout(1000)
      await expect(toolbar.exitSketchBtn).toBeEnabled()
      await toolbar.exitSketchBtn.click()
      await page.waitForTimeout(1000)
      await expect(toolbar.startSketchBtn).toBeEnabled()
    })

    await test.step('Delete first constraint from feature tree and verify code updates', async () => {
      const caret = await toolbar.getFeatureTreeSketchBlockGroupCaret(0)
      await caret.click()
      const op = await toolbar.getFeatureTreeOperation(
        'Horizontal Constraint',
        0
      )
      await op.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('horizontal(line1)')
    })

    await test.step('Delete second constraint from feature tree and verify code updates', async () => {
      const caret = await toolbar.getFeatureTreeSketchBlockGroupCaret(0)
      await caret.click()
      const op = await toolbar.getFeatureTreeOperation(
        'Coincident Constraint',
        0
      )
      await op.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain(
        'coincident([line2.start, line1.end])'
      )
    })

    await test.step('Delete sketch block from feature tree and verify code updates', async () => {
      const op = await toolbar.getFeatureTreeOperation('sketch001', 0)
      await op.click({ button: 'right' })
      await page.getByRole('button', { name: 'Delete' }).click()
      await scene.settled(cmdBar)
      await editor.expectEditor.not.toContain('sketch(on')
    })
  })

  test('can extrude sketch regions', async ({
    page,
    context,
    homePage,
    scene,
    cmdBar,
    editor,
    toolbar,
  }) => {
    const code = `@settings(experimentalFeatures = allow)

sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -2.05mm, var -1.99mm], end = [var 2.1mm, var -1.99mm])
  line2 = line(start = [var 2.1mm, var -1.99mm], end = [var 2.1mm, var 2.23mm])
  line3 = line(start = [var 2.1mm, var 2.23mm], end = [var -2.05mm, var 2.23mm])
  line4 = line(start = [var -2.05mm, var 2.23mm], end = [var -2.05mm, var -1.99mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}`
    const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, {
      format: 'ratio',
    })

    await test.step('Set up scene with a closed sketch block', async () => {
      await context.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, code)
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('sketch001 = sketch(on = XZ) {')
    })

    await test.step('Extrude region by clicking center', async () => {
      await toolbar.extrudeButton.click()
      await clickCenter()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'sketches',
        currentArgValue: '',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '',
          Length: '5',
        },
        highlightedHeaderArg: 'Profiles',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '5',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '1 profile',
          Length: '5',
        },
        highlightedHeaderArg: 'length',
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Extrude',
        headerArguments: {
          Profiles: '1 profile',
          Length: '5',
        },
      })
      await cmdBar.submit()
    })

    await test.step('Expect extrusion', async () => {
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain(
        'region(point = [0.025mm, -1.9875mm], sketch = sketch001)'
      )
      await editor.expectEditor.toContain(
        'extrude001 = extrude(region001, length = 5)'
      )
      // TODO: enable in https://github.com/KittyCAD/modeling-app/pull/10547
      // await expect(
      //   page.locator('.cm-lint-marker-error').first()
      // ).not.toBeInViewport()
    })

    // TODO: enable in https://github.com/KittyCAD/modeling-app/pull/10547
    // await test.step('Start sketch and click center face', async () => {
    //   await toolbar.startSketchPlaneSelection()
    //   await clickCenter()
    //   await page.waitForTimeout(1000) // Wait for unavoidable camera animation

    //   await expect(toolbar.exitSketchBtn).toBeEnabled()
    //   await editor.expectEditor.toContain(
    //     /faceOf\(extrude001, face = region001\.tags\./
    //   )
    //   await editor.expectEditor.toContain('sketch002 = sketch(on = ')
    // })
  })
})
