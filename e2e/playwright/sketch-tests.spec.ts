import { test, expect, Page } from '@playwright/test'

import {
  getMovementUtils,
  getUtils,
  PERSIST_MODELING_CONTEXT,
  setup,
  tearDown,
} from './test-utils'
import { uuidv4, roundOff } from 'lib/utils'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Sketch tests', () => {
  test('multi-sketch file shows multiple Edit Sketch buttons', async ({
    page,
    context,
  }) => {
    const u = await getUtils(page)
    const selectionsSnippets = {
      startProfileAt1:
        '|> startProfileAt([-width / 4 + screwRadius, height / 2], %)',
      startProfileAt2: '|> startProfileAt([-width / 2, 0], %)',
      startProfileAt3: '|> startProfileAt([0, thickness], %)',
    }
    await context.addInitScript(
      async ({ startProfileAt1, startProfileAt2, startProfileAt3 }: any) => {
        localStorage.setItem(
          'persistCode',
          `
  const width = 20
  const height = 10
  const thickness = 5
  const screwRadius = 3
  const wireRadius = 2
  const wireOffset = 0.5
  
  const screwHole = startSketchOn('XY')
    ${startProfileAt1}
    |> arc({
          radius: screwRadius,
          angle_start: 0,
          angle_end: 360
        }, %)
  
  const part001 = startSketchOn('XY')
    ${startProfileAt2}
    |> xLine(width * .5, %)
    |> yLine(height, %)
    |> xLine(-width * .5, %)
    |> close(%)
    |> hole(screwHole, %)
    |> extrude(thickness, %)
  
  const part002 = startSketchOn('-XZ')
    ${startProfileAt3}
    |> xLine(width / 4, %)
    |> tangentialArcTo([width / 2, 0], false, %)
    |> xLine(-width / 4 + wireRadius, %)
    |> yLine(wireOffset, %)
    |> arc({
          radius: wireRadius,
          angle_start: 0,
          angle_end: 180
        }, %)
    |> yLine(-wireOffset, %)
    |> xLine(-width / 4, %)
    |> close(%)
    |> extrude(-height, %)
  `
        )
      },
      selectionsSnippets
    )
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await page.getByText(selectionsSnippets.startProfileAt1).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()

    await page.getByText(selectionsSnippets.startProfileAt2).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()

    await page.getByText(selectionsSnippets.startProfileAt3).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
  })
  test('Can delete most of a sketch and the line tool will still work', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.61, -14.01], %)
  |> line([12.73, -0.09], %)
  |> tangentialArcTo([24.95, -5.38], false, %)`
      )
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await expect(async () => {
      await page.mouse.click(700, 200)
      await page.getByText('tangentialArcTo([24.95, -5.38], false, %)').click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeEnabled({ timeout: 1000 })
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
    }).toPass({ timeout: 40_000, intervals: [1_000] })

    await page.waitForTimeout(600) // wait for animation

    await page.getByText('tangentialArcTo([24.95, -5.38], false, %)').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')
    await u.openAndClearDebugPanel()

    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'Line', exact: true }).click()
    await page.waitForTimeout(100)

    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.61, -14.01], %)
  |> line([0.31, 16.47], %)`
    )
  })
  test('Can exit selection of face', async ({ page }) => {
    // Load the app with the code panes
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', ``)
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

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
  test.describe('Can edit segments by dragging their handles', () => {
    const doEditSegmentsByDraggingHandle = async (
      page: Page,
      openPanes: string[]
    ) => {
      // Load the app with the code panes
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const sketch001 = startSketchOn('XZ')
      |> startProfileAt([4.61, -14.01], %)
      |> line([12.73, -0.09], %)
      |> tangentialArcTo([24.95, -5.38], false, %)
      |> close(%)`
        )
      })

      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      await page.waitForTimeout(100)
      await u.openAndClearDebugPanel()
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          vantage: { x: 0, y: -1250, z: 580 },
          center: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 0, z: 1 },
        },
      })
      await page.waitForTimeout(100)
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      await page.waitForTimeout(100)
      await u.closeDebugPanel()

      // If we have the code pane open, we should see the code.
      if (openPanes.includes('code')) {
        await expect(u.codeLocator)
          .toHaveText(`const sketch001 = startSketchOn('XZ')
      |> startProfileAt([4.61, -14.01], %)
      |> line([12.73, -0.09], %)
      |> tangentialArcTo([24.95, -5.38], false, %)
      |> close(%)`)
      } else {
        // Ensure we don't see the code.
        await expect(u.codeLocator).not.toBeVisible()
      }

      const startPX = [665, 458]

      const dragPX = 30
      let prevContent = ''

      if (openPanes.includes('code')) {
        await page.getByText('startProfileAt([4.61, -14.01], %)').click()
      } else {
        // Wait for the render.
        await page.waitForTimeout(1000)
        // Select the sketch
        await page.mouse.click(700, 370)
      }
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(400)
      if (openPanes.includes('code')) {
        prevContent = await page.locator('.cm-content').innerText()
      }

      const step5 = { steps: 5 }

      await expect(page.getByTestId('segment-overlay')).toHaveCount(2)

      // drag startProfieAt handle
      await page.mouse.move(startPX[0], startPX[1])
      await page.mouse.down()
      await page.mouse.move(startPX[0] + dragPX, startPX[1] - dragPX, step5)
      await page.mouse.up()

      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
        prevContent = await page.locator('.cm-content').innerText()
      }

      // drag line handle
      await page.waitForTimeout(100)

      const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
      await page.mouse.move(lineEnd.x - 5, lineEnd.y)
      await page.mouse.down()
      await page.mouse.move(lineEnd.x + dragPX, lineEnd.y - dragPX, step5)
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
        prevContent = await page.locator('.cm-content').innerText()
      }

      // drag tangentialArcTo handle
      const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
      await page.mouse.move(tangentEnd.x, tangentEnd.y - 5)
      await page.mouse.down()
      await page.mouse.move(tangentEnd.x + dragPX, tangentEnd.y - dragPX, step5)
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      }

      // Open the code pane
      await u.openKclCodePanel()

      // expect the code to have changed
      await expect(page.locator('.cm-content'))
        .toHaveText(`const sketch001 = startSketchOn('XZ')
      |> startProfileAt([6.44, -12.07], %)
      |> line([14.72, 1.97], %)
      |> tangentialArcTo([24.95, -5.38], false, %)
      |> line([1.97, 2.06], %)
      |> close(%)`)
    }
    test('code pane open at start-handles', async ({ page }) => {
      // Load the app with the code panes
      await page.addInitScript(async () => {
        localStorage.setItem(
          'store',
          JSON.stringify({
            state: {
              openPanes: ['code'],
            },
            version: 0,
          })
        )
      })
      await doEditSegmentsByDraggingHandle(page, ['code'])
    })

    test('code pane closed at start-handles', async ({ page }) => {
      // Load the app with the code panes
      await page.addInitScript(async (persistModelingContext) => {
        localStorage.setItem(
          persistModelingContext,
          JSON.stringify({ openPanes: [] })
        )
      }, PERSIST_MODELING_CONTEXT)
      await doEditSegmentsByDraggingHandle(page, [])
    })
  })

  // failing for the same reason as "Can undo a sketch modification with ctrl+z"
  // please fix together
  test.fixme(
    'Can edit a sketch that has been extruded in the same pipe',
    async ({ page }) => {
      const u = await getUtils(page)
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)
    |> extrude(5, %)`
        )
      })

      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      await page.waitForTimeout(100)
      await u.openAndClearDebugPanel()
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          vantage: { x: 0, y: -1250, z: 580 },
          center: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 0, z: 1 },
        },
      })
      await page.waitForTimeout(100)
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      await page.waitForTimeout(100)

      const startPX = [665, 458]

      const dragPX = 40

      await page.getByText('startProfileAt([4.61, -14.01], %)').click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeVisible()
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(400)
      let prevContent = await page.locator('.cm-content').innerText()

      await expect(page.getByTestId('segment-overlay')).toHaveCount(2)

      // drag startProfieAt handle
      await page.dragAndDrop('#stream', '#stream', {
        sourcePosition: { x: startPX[0], y: startPX[1] },
        targetPosition: { x: startPX[0] + dragPX, y: startPX[1] + dragPX },
      })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      // drag line handle
      await page.waitForTimeout(100)

      const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
      await page.waitForTimeout(100)
      await page.dragAndDrop('#stream', '#stream', {
        sourcePosition: { x: lineEnd.x - 5, y: lineEnd.y },
        targetPosition: { x: lineEnd.x + dragPX, y: lineEnd.y + dragPX },
      })
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      // drag tangentialArcTo handle
      const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
      await page.dragAndDrop('#stream', '#stream', {
        sourcePosition: { x: tangentEnd.x, y: tangentEnd.y - 5 },
        targetPosition: {
          x: tangentEnd.x + dragPX,
          y: tangentEnd.y + dragPX,
        },
      })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

      // expect the code to have changed
      await expect(page.locator('.cm-content'))
        .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([7.12, -16.82], %)
    |> line([15.4, -2.74], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> line([2.65, -2.69], %)
    |> close(%)
    |> extrude(5, %)`)
    }
  )

  test('Can edit a sketch that has been revolved in the same pipe', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> close(%)
    |> revolve({ axis: "X",}, %)`
      )
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.waitForTimeout(100)
    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 0, y: -1250, z: 580 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await page.waitForTimeout(100)
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await page.waitForTimeout(100)

    const startPX = [665, 458]

    const dragPX = 30

    await page.getByText('startProfileAt([4.61, -14.01], %)').click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(400)
    let prevContent = await page.locator('.cm-content').innerText()

    const step5 = { steps: 5 }

    await expect(page.getByTestId('segment-overlay')).toHaveCount(2)

    // drag startProfieAt handle
    await page.mouse.move(startPX[0], startPX[1])
    await page.mouse.down()
    await page.mouse.move(startPX[0] + dragPX, startPX[1] - dragPX, step5)
    await page.mouse.up()

    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
    prevContent = await page.locator('.cm-content').innerText()

    // drag line handle
    await page.waitForTimeout(100)

    const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
    await page.mouse.move(lineEnd.x - 5, lineEnd.y)
    await page.mouse.down()
    await page.mouse.move(lineEnd.x + dragPX, lineEnd.y - dragPX, step5)
    await page.mouse.up()
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
    prevContent = await page.locator('.cm-content').innerText()

    // drag tangentialArcTo handle
    const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
    await page.mouse.move(tangentEnd.x, tangentEnd.y - 5)
    await page.mouse.down()
    await page.mouse.move(tangentEnd.x + dragPX, tangentEnd.y - dragPX, step5)
    await page.mouse.up()
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

    // expect the code to have changed
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt([6.44, -12.07], %)
    |> line([14.72, 1.97], %)
    |> tangentialArcTo([24.95, -5.38], false, %)
    |> line([1.97, 2.06], %)
    |> close(%)
    |> revolve({ axis: "X" }, %)`)
  })
  test('Can add multiple sketches', async ({ page }) => {
    test.skip(process.platform === 'darwin', 'Can add multiple sketches')
    const u = await getUtils(page)
    const viewportSize = { width: 1200, height: 500 }
    await page.setViewportSize(viewportSize)

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 }
    const { toSU, click00r } = getMovementUtils({ center, page })

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    // click on "Start Sketch" button
    await u.clearCommandLogs()
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    let codeStr = "const sketch001 = startSketchOn('XY')"

    await page.mouse.click(center.x, viewportSize.height * 0.55)
    await expect(u.codeLocator).toHaveText(codeStr)
    await u.closeDebugPanel()
    await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

    await click00r(0, 0)
    codeStr += `  |> startProfileAt(${toSU([0, 0])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(50, 0)
    await page.waitForTimeout(100)
    codeStr += `  |> line(${toSU([50, 0])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 50)
    codeStr += `  |> line(${toSU([0, 50])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-50, 0)
    codeStr += `  |> line(${toSU([-50, 0])}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    // exit the sketch, reset relative clicker
    click00r(undefined, undefined)
    await u.openAndClearDebugPanel()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await page.waitForTimeout(250)
    await u.clearCommandLogs()

    // start a new sketch
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    // when exiting the sketch above the camera is still looking down at XY,
    // so selecting the plane again is a bit easier.
    await page.mouse.click(center.x + 200, center.y + 100)
    await page.waitForTimeout(600) // TODO detect animation ending, or disable animation
    codeStr += "const sketch002 = startSketchOn('XY')"
    await expect(u.codeLocator).toHaveText(codeStr)
    await u.closeDebugPanel()

    await click00r(30, 0)
    codeStr += `  |> startProfileAt([1.53, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(30, 0)
    codeStr += `  |> line([1.53, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 30)
    codeStr += `  |> line([0, -1.53], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-30, 0)
    codeStr += `  |> line([-1.53, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(undefined, undefined)
    await u.openAndClearDebugPanel()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.updateCamPosition([100, 100, 100])
    await u.clearCommandLogs()
  })
  test.describe('Snap to close works (at any scale)', () => {
    const doSnapAtDifferentScales = async (
      page: any,
      camPos: [number, number, number],
      scale = 1
    ) => {
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()
      await u.openDebugPanel()

      const code = `const sketch001 = startSketchOn('-XZ')
    |> startProfileAt([${roundOff(scale * 69.6)}, ${roundOff(scale * 34.8)}], %)
    |> line([${roundOff(scale * 139.19)}, 0], %)
    |> line([0, -${roundOff(scale * 139.2)}], %)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)`

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
      await expect(page.locator('.cm-content')).toHaveText(
        `const sketch001 = startSketchOn('-XZ')`
      )

      let prevContent = await page.locator('.cm-content').innerText()

      const pointA = [700, 200]
      const pointB = [900, 200]
      const pointC = [900, 400]

      // draw three lines
      await page.waitForTimeout(500)
      await page.mouse.move(pointA[0], pointA[1], { steps: 10 })
      await page.mouse.click(pointA[0], pointA[1], { delay: 200 })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await page.mouse.move(pointB[0], pointB[1], { steps: 10 })
      await page.mouse.click(pointB[0], pointB[1], { delay: 200 })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await page.mouse.move(pointC[0], pointC[1], { steps: 10 })
      await page.mouse.click(pointC[0], pointC[1], { delay: 200 })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await page.mouse.move(pointA[0] - 12, pointA[1] + 12, { steps: 10 })
      const pointNotQuiteA = [pointA[0] - 7, pointA[1] + 7]
      await page.mouse.move(pointNotQuiteA[0], pointNotQuiteA[1], { steps: 10 })

      await page.mouse.click(pointNotQuiteA[0], pointNotQuiteA[1], {
        delay: 200,
      })
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()

      await expect(page.locator('.cm-content')).toHaveText(code)
      // Assert the tool was unequipped
      await expect(
        page.getByRole('button', { name: 'Line', exact: true })
      ).not.toHaveAttribute('aria-pressed', 'true')

      // exit sketch
      await u.openAndClearDebugPanel()
      await page.getByRole('button', { name: 'Exit Sketch' }).click()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.removeCurrentCode()
    }
    test('[0, 100, 100]', async ({ page }) => {
      await doSnapAtDifferentScales(page, [0, 100, 100], 0.01)
    })

    test('[0, 10000, 10000]', async ({ page }) => {
      await doSnapAtDifferentScales(page, [0, 10000, 10000])
    })
  })
  test('exiting a close extrude, has the extrude button enabled ready to go', async ({
    page,
  }) => {
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-0.45, 0.87], %)
  |> line([1.32, 0.38], %)
  |> line([1.02, -1.32], %, $seg01)
  |> line([-1.01, -0.77], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
`
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // click "line([1.32, 0.38], %)"
    await page.getByText(`line([1.32, 0.38], %)`).click()
    await page.waitForTimeout(100)
    // click edit sketch
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(600) // wait for animation

    // exit sketch
    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    // expect extrude button to be enabled
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()

    // click extrude
    await page.getByRole('button', { name: 'Extrude' }).click()

    // sketch selection should already have been made. "Selection: 1 face" only show up when the selection has been made already
    // otherwise the cmdbar would be waiting for a selection.
    await expect(
      page.getByRole('button', { name: 'selection : 1 face', exact: false })
    ).toBeVisible()
  })
  test("Existing sketch with bad code delete user's code", async ({ page }) => {
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-0.45, 0.87], %)
  |> line([1.32, 0.38], %)
  |> line([1.02, -1.32], %, $seg01)
  |> line([-1.01, -0.77], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(5, sketch001)
`
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await page.getByRole('button', { name: 'Start Sketch' }).click()

    await page.mouse.click(622, 355)

    await page.waitForTimeout(800)
    await page.getByText(`END')`).click()
    await page.keyboard.press('End')
    await page.keyboard.press('Enter')
    await page.keyboard.type('  |>', { delay: 100 })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    await page.getByRole('button', { name: 'Exit Sketch' }).click()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).toBeVisible()

    await expect((await u.codeLocator.innerText()).replace(/\s/g, '')).toBe(
      `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-0.45, 0.87], %)
  |> line([1.32, 0.38], %)
  |> line([1.02, -1.32], %, $seg01)
  |> line([-1.01, -0.77], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(5, sketch001)
const sketch002 = startSketchOn(extrude001, 'END')
  |>
`.replace(/\s/g, '')
    )
  })
  test('empty-scene default-planes act as expected', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'Skip on Safari until `window.tearDown` is working there'
    )
    /**
     * Tests the following things
     * 1) The the planes are there on load because the scene is empty
     * 2) The planes don't changes color when hovered initially
     * 3) Putting something in the scene makes the planes hidden
     * 4) Removing everything from the scene shows the plans again
     * 3) Once "start sketch" is click, the planes do respond to hovers
     * 4) Selecting a plan works as expected, i.e. sketch mode
     * 5) Reloading the scene with something already in the scene means the planes are hidden
     */

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const XYPlanePoint = { x: 774, y: 116 } as const
    const unHoveredColor: [number, number, number] = [47, 47, 93]
    expect(
      await u.getGreatestPixDiff(XYPlanePoint, unHoveredColor)
    ).toBeLessThan(8)

    await page.mouse.move(XYPlanePoint.x, XYPlanePoint.y)
    await page.waitForTimeout(200)

    // color should not change for having been hovered
    expect(
      await u.getGreatestPixDiff(XYPlanePoint, unHoveredColor)
    ).toBeLessThan(8)

    await u.openAndClearDebugPanel()

    await u.codeLocator.fill(`const sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> xLine(-20, %)
`)

    await u.expectCmdLog('[data-message-type="execution-done"]')

    const noPlanesColor: [number, number, number] = [30, 30, 30]
    expect(
      await u.getGreatestPixDiff(XYPlanePoint, noPlanesColor)
    ).toBeLessThan(3)

    await u.clearCommandLogs()
    await u.removeCurrentCode()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await expect
      .poll(() => u.getGreatestPixDiff(XYPlanePoint, unHoveredColor), {
        timeout: 5_000,
      })
      .toBeLessThan(8)

    // click start Sketch
    await page.getByRole('button', { name: 'Start Sketch' }).click()
    await page.mouse.move(XYPlanePoint.x, XYPlanePoint.y, { steps: 5 })
    const hoveredColor: [number, number, number] = [93, 93, 127]
    // now that we're expecting the user to select a plan, it does respond to hover
    await expect
      .poll(() => u.getGreatestPixDiff(XYPlanePoint, hoveredColor))
      .toBeLessThan(8)

    await page.mouse.click(XYPlanePoint.x, XYPlanePoint.y)
    await page.waitForTimeout(600)

    await page.mouse.click(XYPlanePoint.x, XYPlanePoint.y)
    await page.waitForTimeout(200)
    await page.mouse.click(XYPlanePoint.x + 50, XYPlanePoint.y + 50)
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt([11.8, 9.09], %)
  |> line([3.39, -3.39], %)
`)

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([11.8, 9.09], %)
  |> line([3.39, -3.39], %)
`
      )
    })
    await page.reload()
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // expect there to be no planes on load since there's something in the scene
    expect(
      await u.getGreatestPixDiff(XYPlanePoint, noPlanesColor)
    ).toBeLessThan(3)
  })
})
