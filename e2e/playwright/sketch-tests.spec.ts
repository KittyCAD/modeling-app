import { test, expect, Page } from '@playwright/test'
import { test as test2, expect as expect2 } from './fixtures/fixtureSetup'

import {
  getMovementUtils,
  getUtils,
  PERSIST_MODELING_CONTEXT,
  setup,
  tearDown,
} from './test-utils'
import { uuidv4, roundOff } from 'lib/utils'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
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
  width = 20
  height = 10
  thickness = 5
  screwRadius = 3
  wireRadius = 2
  wireOffset = 0.5

  screwHole = startSketchOn('XY')
    ${startProfileAt1}
    |> arc({
          radius: screwRadius,
          angle_start: 0,
          angle_end: 360
        }, %)

  part001 = startSketchOn('XY')
    ${startProfileAt2}
    |> xLine(width * .5, %)
    |> yLine(height, %)
    |> xLine(-width * .5, %)
    |> close(%)
    |> hole(screwHole, %)
    |> extrude(thickness, %)

  part002 = startSketchOn('-XZ')
    ${startProfileAt3}
    |> xLine(width / 4, %)
    |> tangentialArcTo([width / 2, 0], %)
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
        `sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.61, -14.01], %)
  |> line([12.73, -0.09], %)
  |> tangentialArcTo([24.95, -5.38], %)`
      )
    })

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await expect(async () => {
      await page.mouse.click(700, 200)
      await page.getByText('tangentialArcTo([24.95, -5.38], %)').click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeEnabled({ timeout: 1000 })
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
    }).toPass({ timeout: 40_000, intervals: [1_000] })

    await page.waitForTimeout(600) // wait for animation

    await page.getByText('tangentialArcTo([24.95, -5.38], %)').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')
    await u.openAndClearDebugPanel()

    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'line Line', exact: true }).click()
    await page.waitForTimeout(100)

    await expect(async () => {
      await page.mouse.click(700, 200)

      await expect.poll(u.normalisedEditorCode, { timeout: 1000 })
        .toBe(`sketch001 = startSketchOn('XZ')
  |> startProfileAt([12.34, -12.34], %)
  |> line([-12.34, 12.34], %)

`)
    }).toPass({ timeout: 40_000, intervals: [1_000] })
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
          `sketch001 = startSketchOn('XZ')
      |> startProfileAt([4.61, -14.01], %)
      |> line([12.73, -0.09], %)
      |> tangentialArcTo([24.95, -5.38], %)
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
        await expect(u.codeLocator).toHaveText(`sketch001 = startSketchOn('XZ')
      |> startProfileAt([4.61, -14.01], %)
      |> line([12.73, -0.09], %)
      |> tangentialArcTo([24.95, -5.38], %)
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
        .toHaveText(`sketch001 = startSketchOn('XZ')
      |> startProfileAt([6.44, -12.07], %)
      |> line([14.72, 1.97], %)
      |> tangentialArcTo([24.95, -5.38], %)
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

  test('Can edit a circle center and radius by dragging its handles', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
  |> circle({ center: [4.61, -5.01], radius: 8 }, %)`
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

    const startPX = [667, 325]

    const dragPX = 40

    await page
      .getByText('circle({ center: [4.61, -5.01], radius: 8 }, %)')
      .click()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).toBeVisible()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(400)
    let prevContent = await page.locator('.cm-content').innerText()

    await expect(page.getByTestId('segment-overlay')).toHaveCount(1)

    await test.step('drag circle center handle', async () => {
      await page.dragAndDrop('#stream', '#stream', {
        sourcePosition: { x: startPX[0], y: startPX[1] },
        targetPosition: { x: startPX[0] + dragPX, y: startPX[1] - dragPX },
      })
      await page.waitForTimeout(100)
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()
    })

    await test.step('drag circle radius handle', async () => {
      await page.waitForTimeout(100)

      const lineEnd = await u.getBoundingBox('[data-overlay-index="0"]')
      await page.waitForTimeout(100)
      await page.dragAndDrop('#stream', '#stream', {
        sourcePosition: { x: lineEnd.x - 5, y: lineEnd.y },
        targetPosition: { x: lineEnd.x + dragPX * 2, y: lineEnd.y + dragPX },
      })
      await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      prevContent = await page.locator('.cm-content').innerText()
    })

    // expect the code to have changed
    await expect(page.locator('.cm-content'))
      .toHaveText(`sketch001 = startSketchOn('XZ')
  |> circle({ center: [7.26, -2.37], radius: 11.44 }, %)
`)
  })
  test('Can edit a sketch that has been extruded in the same pipe', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -10.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -0.38], %)
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

    const startPX = [665, 397]

    const dragPX = 40

    await page.getByText('startProfileAt([4.61, -10.01], %)').click()
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
      sourcePosition: { x: tangentEnd.x + 10, y: tangentEnd.y - 5 },
      targetPosition: {
        x: tangentEnd.x + dragPX,
        y: tangentEnd.y + dragPX,
      },
    })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

    // expect the code to have changed
    await expect(page.locator('.cm-content'))
      .toHaveText(`sketch001 = startSketchOn('XZ')
  |> startProfileAt([7.12, -12.68], %)
  |> line([15.39, -2.78], %)
  |> tangentialArcTo([27.6, -3.05], %)
  |> close(%)
  |> extrude(5, %)
`)
  })

  test('Can edit a sketch that has been revolved in the same pipe', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> line([12.73, -0.09], %)
    |> tangentialArcTo([24.95, -5.38], %)
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
      .toHaveText(`sketch001 = startSketchOn('XZ')
    |> startProfileAt([6.44, -12.07], %)
    |> line([14.72, 1.97], %)
    |> tangentialArcTo([24.95, -5.38], %)
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

    let codeStr = "sketch001 = startSketchOn('XY')"

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
    await click00r(undefined, undefined)
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
    codeStr += "sketch002 = startSketchOn('XY')"
    await expect(u.codeLocator).toHaveText(codeStr)
    await u.closeDebugPanel()

    await click00r(30, 0)
    codeStr += `  |> startProfileAt([2.03, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(30, 0)
    codeStr += `  |> line([2.04, 0], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 30)
    codeStr += `  |> line([0, -2.03], %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-30, 0)
    codeStr += `  |> line([-2.04, 0], %)`
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

      const code = `sketch001 = startSketchOn('-XZ')
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
        `sketch001 = startSketchOn('-XZ')`
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
        page.getByRole('button', { name: 'line Line', exact: true })
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
        `sketch001 = startSketchOn('XZ')
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

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // click "line([1.32, 0.38], %)"
    await page.getByText(`line([1.32, 0.38], %)`).click()
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
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()

    // click extrude
    await page.getByRole('button', { name: 'Extrude' }).click()

    // sketch selection should already have been made. "Selection: 1 face" only show up when the selection has been made already
    // otherwise the cmdbar would be waiting for a selection.
    await expect(
      page.getByRole('button', { name: 'selection : 1 face', exact: false })
    ).toBeVisible({
      timeout: 10_000,
    })
  })
  test("Existing sketch with bad code delete user's code", async ({ page }) => {
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
  |> startProfileAt([-0.45, 0.87], %)
  |> line([1.32, 0.38], %)
  |> line([1.02, -1.32], %, $seg01)
  |> line([-1.01, -0.77], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(5, sketch001)
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
      `sketch001 = startSketchOn('XZ')
  |> startProfileAt([-0.45, 0.87], %)
  |> line([1.32, 0.38], %)
  |> line([1.02, -1.32], %, $seg01)
  |> line([-1.01, -0.77], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(5, sketch001)
sketch002 = startSketchOn(extrude001, 'END')
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

    await u.codeLocator.fill(`sketch001 = startSketchOn('XY')
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
    await expect(u.codeLocator).toHaveText(`sketch001 = startSketchOn('XZ')
  |> startProfileAt([11.8, 9.09], %)
  |> line([3.39, -3.39], %)
`)

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
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

  test('Can attempt to sketch on revolved face', async ({
    page,
    browserName,
  }) => {
    test.skip(
      browserName === 'webkit',
      'Skip on Safari until `window.tearDown` is working there'
    )
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `lugHeadLength = 0.25
        lugDiameter = 0.5
        lugLength = 2

        fn lug = (origin, length, diameter, plane) => {
          lugSketch = startSketchOn(plane)
            |> startProfileAt([origin[0] + lugDiameter / 2, origin[1]], %)
            |> angledLineOfYLength({ angle: 60, length: lugHeadLength }, %)
            |> xLineTo(0 + .001, %)
            |> yLineTo(0, %)
            |> close(%)
            |> revolve({ axis: "Y" }, %)

          return lugSketch
        }

        lug([0, 0], 10, .5, "XY")`
      )
    })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    /***
     * Test Plan
     * Start the sketch mode
     * Click the middle of the screen which should click the top face that is revolved
     * Wait till you see the line tool be enabled
     * Wait till you see the exit sketch enabled
     *
     * This is supposed to test that you are allowed to go into sketch mode to sketch on a revolved face
     */

    await page.getByRole('button', { name: 'Start Sketch' }).click()

    await expect(async () => {
      await page.mouse.click(600, 250)
      await page.waitForTimeout(1000)
      await expect(
        page.getByRole('button', { name: 'Exit Sketch' })
      ).toBeVisible()
      await expect(
        page.getByRole('button', { name: 'line Line', exact: true })
      ).toHaveAttribute('aria-pressed', 'true')
    }).toPass({ timeout: 40_000, intervals: [1_000] })
  })
})

test2.describe('Sketch mode should be toleratant to syntax errors', () => {
  test2(
    'adding a syntax error, recovers after fixing',
    { tag: ['@skipWin'] },
    async ({ app, scene, editor, toolbar }) => {
      test.skip(
        process.platform === 'win32',
        'a codemirror error appears in this test only on windows, that causes the test to fail only because of our "no new error" logic, but it can not be replicated locally'
      )
      const file = await app.getInputFile('e2e-can-sketch-on-chamfer.kcl')
      await app.initialise(file)

      const [objClick] = scene.makeMouseHelpers(600, 250)
      const arrowHeadLocation = { x: 604, y: 129 } as const
      const arrowHeadWhite: [number, number, number] = [255, 255, 255]
      const backgroundGray: [number, number, number] = [28, 28, 28]
      const verifyArrowHeadColor = async (c: [number, number, number]) =>
        scene.expectPixelColor(c, arrowHeadLocation, 15)

      await test.step('check chamfer selection changes cursor positon', async () => {
        await expect2(async () => {
          // sometimes initial click doesn't register
          await objClick()
          await editor.expectActiveLinesToBe([
            '|> startProfileAt([75.8, 317.2], %) // [$startCapTag, $EndCapTag]',
          ])
        }).toPass({ timeout: 15_000, intervals: [500] })
      })

      await test.step('enter sketch and sanity check segments have been drawn', async () => {
        await toolbar.editSketch()
        // this checks sketch segments have been drawn
        await verifyArrowHeadColor(arrowHeadWhite)
      })

      await test.step('Make typo and check the segments have Disappeared and there is a syntax error', async () => {
        await editor.replaceCode('lineTo([pro', 'badBadBadFn([pro')
        await editor.expectState({
          activeLines: [],
          diagnostics: ['memoryitemkey`badBadBadFn`isnotdefined'],
          highlightedCode: '',
        })
        // this checks sketch segments have failed to be drawn
        await verifyArrowHeadColor(backgroundGray)
      })

      await test.step('', async () => {
        await editor.replaceCode('badBadBadFn([pro', 'lineTo([pro')
        await editor.expectState({
          activeLines: [],
          diagnostics: [],
          highlightedCode: '',
        })
        // this checks sketch segments have been drawn
        await verifyArrowHeadColor(arrowHeadWhite)
      })
      await app.page.waitForTimeout(100)
    }
  )
})
