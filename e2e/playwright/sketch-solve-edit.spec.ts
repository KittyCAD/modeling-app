import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'

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

const TEST_CODE = `@settings(experimentalFeatures = allow)

mySketch = startSketchOn(XZ)
myProfile = startProfile(mySketch, at = [0, 1])
  |> line(end = [-2.5, 3.75])
sketch(on = XZ) {
  sketch2::line(start = [var -0.88mm, var 0.54mm], end = [var 0.63mm, var 1.18mm])
  sketch2::line(start = [var 0.85mm, var -0.57mm], end = [var -0.21mm, var 1.55mm])
  sketch2::line(start = [var -1.59mm, var -0.49mm], end = [var 0.09mm, var -0.56mm])
  sketch2::point(at = [var -1.44mm, var 1.16mm])
  sketch2::point(at = [var -0.41mm, var 0.26mm])
  sketch2::point(at = [var -0.36mm, var -1.23mm])
}
`

test.describe('Sketch solve edit tests', () => {
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
      await editor.scrollToText(
        'sketch2::line(start = [var -0.88mm, var 0.54mm]'
      )
      await page
        .getByText('sketch2::line(start = [var -0.88mm, var 0.54mm]')
        .click()

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

    await test.step('Drag point segment 13 down by 30px', async () => {
      const segmentBox = await scene.getBoundingBoxOrThrow(
        '[data-segment_id="13"]'
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

    await test.step('Drag line segment by dragging midpoint between points 8 and 9 down by 50px', async () => {
      const midpoint = await getMidpointBetweenSegments(scene, '8', '9')

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
  }) => {
    const INITIAL_CODE = `@settings(experimentalFeatures = allow)
`

    await test.step('Set up the app with initial code', async () => {
      await context.addInitScript(async (code) => {
        localStorage.setItem('persistCode', code)
      }, INITIAL_CODE)

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
    })

    await test.step('Open settings and toggle Use New Sketch Mode', async () => {
      await cmdBar.openCmdBar()
      await cmdBar.chooseCommand('Settings · modeling · use new sketch mode')
      await cmdBar.selectOption({ name: 'on' }).click()
      // TODO change back to 200 or similar
      await page.waitForTimeout(1000) // Brief wait for tool to be active
    })

    await test.step('Start a new sketch and select a plane', async () => {
      await toolbar.startSketchOnDefaultPlane('Top plane')
      await editor.expectEditor.toContain('sketch(on = XY) {')
    })

    await test.step('Add three line segments', async () => {
      await toolbar.lineBtn.click()
      await page.waitForTimeout(200) // Brief wait for tool to be active

      let previousCode = await editor.getCurrentCode()

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

      // Second line segment
      const [line2Start] = scene.makeMouseHelpers(0.5, 0.4, {
        format: 'ratio',
      })
      const [line2End] = scene.makeMouseHelpers(0.8, 0.2, {
        format: 'ratio',
      })
      await line2Start()
      previousCode = await waitForCodeChange(page, previousCode)
      await line2End()
      previousCode = await waitForCodeChange(page, previousCode)

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
      await waitForCodeChange(page, previousCode)
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
      const [point2Click] = scene.makeMouseHelpers(0.4, 0.6, {
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

    await test.step('Select segments 1 and 8, then apply coincident constraint', async () => {
      await page.locator('[data-segment_id="1"]').click()
      // await page.waitForTimeout(100)
      await page.locator('[data-segment_id="8"]').click()
      // await page.waitForTimeout(100)

      // Click the coincident tool
      await page.getByTestId('coincident').click()

      await editor.expectEditor.toContain(
        'sketch2::coincident([line1.start, line2.end])'
      )
      await page.waitForTimeout(100)
    })
    const [clearSelection] = scene.makeMouseHelpers(0.5, 0.5, {
      format: 'ratio',
    })
    await test.step('Select lines between segments 1-2 and 4-5, then apply parallel constraint', async () => {
      await clearSelection()
      const segmentBox = await scene.getBoundingBoxOrThrow(
        '[data-segment_id="1"]'
      )
      const centerX = segmentBox.x + segmentBox.width / 2
      const centerY = segmentBox.y + segmentBox.height / 2
      await page.mouse.move(centerX, centerY)
      await page.mouse.down()
      await page.mouse.move(centerX + 200, centerY + 0, { steps: 5 })
      await page.mouse.up()
    })

    await test.step('Select lines between segments 1-2 and 4-5, then apply parallel constraint', async () => {
      // Click in dead space to clear selections
      const midpoint1_2 = await getMidpointBetweenSegments(scene, '1', '2')
      const midpoint4_5 = await getMidpointBetweenSegments(scene, '4', '5')

      await clearSelection()
      // await page.waitForTimeout(100)
      await page.mouse.click(midpoint1_2.x, midpoint1_2.y)
      // await page.waitForTimeout(100)
      await page.mouse.click(midpoint4_5.x, midpoint4_5.y)
      // await page.waitForTimeout(100)

      // Click the parallel tool
      // await page.waitForTimeout(100)
      await page.getByTestId('Parallel').click()

      await editor.expectEditor.toContain('sketch2::parallel([line1, line3])')
    })
  })
})
