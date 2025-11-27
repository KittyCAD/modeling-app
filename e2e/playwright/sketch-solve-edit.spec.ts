import { expect, test } from '@e2e/playwright/zoo-test'

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
    await editor.scrollToText('sketch2::line(start = [var -0.88mm, var 0.54mm]')
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
    const point8Box = await scene.getBoundingBoxOrThrow('[data-segment_id="8"]')
    const point9Box = await scene.getBoundingBoxOrThrow('[data-segment_id="9"]')

    const point8CenterX = point8Box.x + point8Box.width / 2
    const point8CenterY = point8Box.y + point8Box.height / 2
    const point9CenterX = point9Box.x + point9Box.width / 2
    const point9CenterY = point9Box.y + point9Box.height / 2

    const midpointX = (point8CenterX + point9CenterX) / 2
    const midpointY = (point8CenterY + point9CenterY) / 2

    const lineToEdit = getCodeLine({ code: TEST_CODE, line: 8 })
    await editor.expectEditor.toContain(lineToEdit)

    await page.mouse.move(midpointX, midpointY)
    await page.mouse.down()
    await page.mouse.move(midpointX, midpointY + 50, { steps: 5 })
    await page.mouse.up()

    await page.waitForTimeout(500)

    await editor.expectEditor.not.toContain(lineToEdit)
  })
})
