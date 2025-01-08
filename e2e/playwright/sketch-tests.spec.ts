import { test, expect, Page } from './zoo-test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HomePageFixture } from './fixtures/homePageFixture'

import {
  getMovementUtils,
  getUtils,
  PERSIST_MODELING_CONTEXT,
  TEST_COLORS,
} from './test-utils'
import { uuidv4, roundOff } from 'lib/utils'

test.describe('Sketch tests', () => {
  test('multi-sketch file shows multiple Edit Sketch buttons', async ({
    page,
    context,
    homePage,
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
        radius = screwRadius,
        angle_start = 0,
        angle_end = 360
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
        radius = wireRadius,
        angle_start = 0,
        angle_end = 180
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
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

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
  test('Can delete most of a sketch and the line tool will still work', async ({
    page,
    scene,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
  |> startProfileAt([2.61, -4.01], %)
  |> xLine(8.73, %)
  |> tangentialArcTo([8.33, -1.31], %)`
      )
    })

    await homePage.goToModelingScene()

    await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 587, y: 270 }, 15)

    await expect(async () => {
      await page.mouse.click(700, 200)
      await page.getByText('tangentialArcTo([8.33, -1.31], %)').click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeEnabled({ timeout: 1000 })
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
    }).toPass({ timeout: 40_000, intervals: [1_000] })

    await page.waitForTimeout(600) // wait for animation

    await page.getByText('tangentialArcTo([8.33, -1.31], %)').click()
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'line Line', exact: true }).click()
    await page.waitForTimeout(500)
    // click start profileAt handle to continue profile
    await page.mouse.click(702, 406, { delay: 500 })
    await page.waitForTimeout(100)
    await page.mouse.move(800, 150)

    await expect(async () => {
      // click to add segment
      await page.mouse.click(700, 200)

      await expect.poll(u.normalisedEditorCode, { timeout: 1000 })
        .toBe(`sketch002 = startSketchOn('XZ')
sketch001 = startProfileAt([12.34, -12.34], sketch002)
  |> yLine(12.34, %)

`)
    }).toPass({ timeout: 5_000, intervals: [1_000] })
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
  test.describe('Can edit segments by dragging their handles', () => {
    const doEditSegmentsByDraggingHandle = async (
      page: Page,
      homePage: HomePageFixture,
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
      await homePage.goToModelingScene()

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
    test('code pane open at start-handles', async ({ page, homePage }) => {
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
      await doEditSegmentsByDraggingHandle(page, homePage, ['code'])
    })

    test('code pane closed at start-handles', async ({ page, homePage }) => {
      // Load the app with the code panes
      await page.addInitScript(async (persistModelingContext) => {
        localStorage.setItem(
          persistModelingContext,
          JSON.stringify({ openPanes: [] })
        )
      }, PERSIST_MODELING_CONTEXT)
      await doEditSegmentsByDraggingHandle(page, homePage, [])
    })
  })

  test('Can edit a circle center and radius by dragging its handles', async ({
    page,
    editor,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
    |> circle({ center = [4.61, -5.01], radius = 8 }, %)`
      )
    })

    await homePage.goToModelingScene()

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
      .getByText('circle({ center = [4.61, -5.01], radius = 8 }, %)')
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

      await editor.expectEditor.not.toContain(prevContent)

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
      await editor.expectEditor.not.toContain(prevContent)
      prevContent = await page.locator('.cm-content').innerText()
    })

    // expect the code to have changed
    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn('XZ')
    |> circle({ center = [7.26, -2.37], radius = 11.44 }, %)`,
      { shouldNormalise: true }
    )
  })
  test('Can edit a sketch that has been extruded in the same pipe', async ({
    page,
    homePage,
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

    await homePage.goToModelingScene()

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
    await page.dragAndDrop('#stream', '#stream', {
      sourcePosition: { x: lineEnd.x - 15, y: lineEnd.y },
      targetPosition: { x: lineEnd.x, y: lineEnd.y + 15 },
    })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
    prevContent = await page.locator('.cm-content').innerText()

    // drag tangentialArcTo handle
    const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
    await page.dragAndDrop('#stream', '#stream', {
      sourcePosition: { x: tangentEnd.x + 10, y: tangentEnd.y - 5 },
      targetPosition: {
        x: tangentEnd.x,
        y: tangentEnd.y - 15,
      },
    })
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-content')).not.toHaveText(prevContent)

    // expect the code to have changed
    await expect(page.locator('.cm-content'))
      .toHaveText(`sketch001 = startSketchOn('XZ')
    |> startProfileAt([7.12, -12.68], %)
    |> line([12.68, -1.09], %)
    |> tangentialArcTo([24.89, 0.68], %)
    |> close(%)
    |> extrude(5, %)
  `)
  })

  test('Can edit a sketch that has been revolved in the same pipe', async ({
    page,
    homePage,
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
  |> revolve({ axis = "X",}, %)`
      )
    })

    await homePage.goToModelingScene()

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
  |> revolve({ axis = "X" }, %)`)
  })
  test('Can add multiple sketches', async ({ page, homePage }) => {
    // TODO: fix this test on windows after the electron migration
    test.skip(process.platform === 'win32', 'Skip on windows')
    const u = await getUtils(page)

    const viewportSize = { width: 1200, height: 500 }
    await page.setBodyDimensions(viewportSize)

    await homePage.goToModelingScene()
    await u.openDebugPanel()

    const center = { x: viewportSize.width / 2, y: viewportSize.height / 2 }
    const { toSU, toU, click00r } = getMovementUtils({ center, page })

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
    codeStr += `profile001 = startProfileAt(${toSU([0, 0])}, sketch001)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(50, 0)
    await page.waitForTimeout(100)
    codeStr += `  |> xLine(${toU(50, 0)[0]}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 50)
    codeStr += `  |> yLine(${toU(0, 50)[1]}, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-50, 0)
    codeStr += `  |> xLine(${toU(-50, 0)[0]}, %)`
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
    codeStr += `profile002 = startProfileAt([2.03, 0], sketch002)`
    await expect(u.codeLocator).toHaveText(codeStr)

    // TODO: I couldn't use `toSU` here because of some rounding error causing
    // it to be off by 0.01
    await click00r(30, 0)
    codeStr += `  |> xLine(2.04, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 30)
    codeStr += `  |> yLine(-2.03, %)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-30, 0)
    codeStr += `  |> xLine(-2.04, %)`
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
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await u.openDebugPanel()

      const code = `sketch001 = startSketchOn('-XZ')
profile001 = startProfileAt([${roundOff(scale * 69.6)}, ${roundOff(
        scale * 34.8
      )}], sketch001)
    |> xLine(${roundOff(scale * 139.19)}, %)
    |> yLine(-${roundOff(scale * 139.2)}, %)
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

      await expect
        .poll(async () => {
          const text = await page.locator('.cm-content').innerText()
          return text.replace(/\s/g, '')
        })
        .toBe(code.replace(/\s/g, ''))

      // Assert the tool stays equipped after a profile is closed (ready for the next one)
      await expect(
        page.getByRole('button', { name: 'line Line', exact: true })
      ).toHaveAttribute('aria-pressed', 'true')

      // exit sketch
      await u.openAndClearDebugPanel()
      await page.getByRole('button', { name: 'Exit Sketch' }).click()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.removeCurrentCode()
    }
    test('[0, 100, 100]', async ({ page, homePage }) => {
      await homePage.goToModelingScene()
      await doSnapAtDifferentScales(page, [0, 100, 100], 0.01)
    })

    test('[0, 10000, 10000]', async ({ page, homePage }) => {
      await homePage.goToModelingScene()
      await doSnapAtDifferentScales(page, [0, 10000, 10000])
    })
  })
  test('exiting a close extrude, has the extrude button enabled ready to go', async ({
    page,
    homePage,
  }) => {
    // TODO: fix this test on windows after the electron migration
    test.skip(process.platform === 'win32', 'Skip on windows')
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
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

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
  test("Existing sketch with bad code delete user's code", async ({
    page,
    homePage,
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
  extrude001 = extrude(5, sketch001)
  `
      )
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

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
  // TODO: fix after electron migration is merged
  test.fixme(
    'empty-scene default-planes act as expected',
    async ({ page, homePage }) => {
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
      await homePage.goToModelingScene()

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
      await page.mouse.move(XYPlanePoint.x, XYPlanePoint.y, { steps: 50 })
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

      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      // expect there to be no planes on load since there's something in the scene
      expect(
        await u.getGreatestPixDiff(XYPlanePoint, noPlanesColor)
      ).toBeLessThan(3)
    }
  )

  test('Can attempt to sketch on revolved face', async ({ page, homePage }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `lugHeadLength = 0.25
      lugDiameter = 0.5
      lugLength = 2
  
      fn lug = (origin, length, diameter, plane) => {
        lugSketch = startSketchOn(plane)
          |> startProfileAt([origin[0] + lugDiameter / 2, origin[1]], %)
          |> angledLineOfYLength({ angle = 60, length = lugHeadLength }, %)
          |> xLineTo(0 + .001, %)
          |> yLineTo(0, %)
          |> close(%)
          |> revolve({ axis = "Y" }, %)
  
        return lugSketch
      }
  
      lug([0, 0], 10, .5, "XY")`
      )
    })

    await homePage.goToModelingScene()

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
        `fn in2mm = (inches) => {
    return inches * 25.4
  }
  
  const railTop = in2mm(.748)
  const railSide = in2mm(.024)
  const railBaseWidth = in2mm(.612)
  const railWideWidth = in2mm(.835)
  const railBaseLength = in2mm(.200)
  const railClampable = in2mm(.200)
  
  const rail = startSketchOn('XZ')
    |> startProfileAt([
     -railTop / 2,
     railClampable + railBaseLength
   ], %)
    |> lineTo([
     railTop / 2,
     railClampable + railBaseLength
   ], %)
    |> lineTo([
     railWideWidth / 2,
     railClampable / 2 + railBaseLength
   ], %, $seg01)
    |> lineTo([railTop / 2, railBaseLength], %)
    |> lineTo([railBaseWidth / 2, railBaseLength], %)
    |> lineTo([railBaseWidth / 2, 0], %)
    |> lineTo([-railBaseWidth / 2, 0], %)
    |> lineTo([-railBaseWidth / 2, railBaseLength], %)
    |> lineTo([-railTop / 2, railBaseLength], %)
    |> lineTo([
     -railWideWidth / 2,
     railClampable / 2 + railBaseLength
   ], %)
    |> lineTo([
     -railTop / 2,
     railClampable + railBaseLength
   ], %)
    |> close(%)
    |> extrude(in2mm(2), %)`
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
})

test.describe('Sketch mode should be toleratant to syntax errors', () => {
  test(
    'adding a syntax error, recovers after fixing',
    { tag: ['@skipWin'] },
    async ({ page, homePage, context, scene, editor, toolbar }) => {
      const file = await fs.readFile(
        path.resolve(
          __dirname,
          '../../',
          './src/wasm-lib/tests/executor/inputs/e2e-can-sketch-on-chamfer.kcl'
        ),
        'utf-8'
      )
      await context.addInitScript((file) => {
        localStorage.setItem('persistCode', file)
      }, file)
      await homePage.goToModelingScene()

      const [objClick] = scene.makeMouseHelpers(600, 250)
      const arrowHeadLocation = { x: 706, y: 129 } as const
      const arrowHeadWhite = TEST_COLORS.WHITE
      const backgroundGray: [number, number, number] = [28, 28, 28]
      const verifyArrowHeadColor = async (c: [number, number, number]) =>
        scene.expectPixelColor(c, arrowHeadLocation, 15)

      await test.step('check chamfer selection changes cursor positon', async () => {
        await expect(async () => {
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
      await page.waitForTimeout(100)
    }
  )
})

test.describe(`Sketching with offset planes`, () => {
  test(`Can select an offset plane to sketch on`, async ({
    context,
    page,
    scene,
    toolbar,
    editor,
    homePage,
  }) => {
    // We seed the scene with a single offset plane
    await context.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `offsetPlane001 = offsetPlane("XY", 10)`
      )
    })

    await homePage.goToModelingScene()

    const [planeClick, planeHover] = scene.makeMouseHelpers(650, 200)

    await test.step(`Start sketching on the offset plane`, async () => {
      await toolbar.startSketchPlaneSelection()

      await test.step(`Hovering should highlight code`, async () => {
        await planeHover()
        await editor.expectState({
          activeLines: [`offsetPlane001=offsetPlane("XY",10)`],
          diagnostics: [],
          highlightedCode: 'offsetPlane("XY", 10)',
        })
      })

      await test.step(`Clicking should select the plane and enter sketch mode`, async () => {
        await planeClick()
        // Have to wait for engine-side animation to finish
        await page.waitForTimeout(600)
        await expect(toolbar.lineBtn).toBeEnabled()
        await editor.expectEditor.toContain('startSketchOn(offsetPlane001)')
        await editor.expectState({
          activeLines: [`offsetPlane001=offsetPlane("XY",10)`],
          diagnostics: [],
          highlightedCode: '',
        })
      })
    })
  })
})

test.describe('multi-profile sketching', () => {
  test('Can add multiple profiles to a sketch (all tool types)', async ({
    scene,
    toolbar,
    editor,
    page,
    homePage,
  }) => {
    await homePage.goToModelingScene()

    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)

    const [startProfile1] = scene.makeMouseHelpers(568, 70)
    const [endLineStartTanArc] = scene.makeMouseHelpers(701, 78)
    const [endArcStartLine] = scene.makeMouseHelpers(745, 189)

    const [startProfile2] = scene.makeMouseHelpers(782, 80)
    const [profile2Point2] = scene.makeMouseHelpers(921, 90)
    const [profile2Point3] = scene.makeMouseHelpers(953, 178)

    const [circle1Center] = scene.makeMouseHelpers(842, 147)
    const [circle1Radius] = scene.makeMouseHelpers(870, 171)

    const [circle2Center] = scene.makeMouseHelpers(850, 222)
    const [circle2Radius] = scene.makeMouseHelpers(843, 230)

    const [crnRect1point1] = scene.makeMouseHelpers(583, 205)
    const [crnRect1point2] = scene.makeMouseHelpers(618, 320)

    const [crnRect2point1] = scene.makeMouseHelpers(663, 215)
    const [crnRect2point2] = scene.makeMouseHelpers(744, 276)

    const [cntrRect1point1] = scene.makeMouseHelpers(624, 387)
    const [cntrRect1point2] = scene.makeMouseHelpers(676, 355)

    const [cntrRect2point1] = scene.makeMouseHelpers(785, 332)
    const [cntrRect2point2] = scene.makeMouseHelpers(808, 286)

    await toolbar.startSketchPlaneSelection()
    await selectXZPlane()
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)
    await editor.expectEditor.toContain(`sketch001 = startSketchOn('XZ')`)
    await test.step('Create a close profile stopping mid profile to equip the tangential arc, and than back to the line tool', async () => {
      await startProfile1()
      await editor.expectEditor.toContain(
        `profile001 = startProfileAt([-2.17, 12.21], sketch001)`
      )

      await endLineStartTanArc()
      await editor.expectEditor.toContain(`|> line([9.02, -0.55], %)`)
      await toolbar.tangentialArcBtn.click()
      await page.waitForTimeout(100)
      await page.mouse.click(745, 359)
      await page.waitForTimeout(100)
      await endLineStartTanArc({ delay: 544 })

      await endArcStartLine()
      await editor.expectEditor.toContain(`|> tangentialArcTo([9.83, 4.14], %)`)
      await toolbar.lineBtn.click()
      await page.waitForTimeout(100)
      await endArcStartLine()

      await page.mouse.click(572, 110)
      await editor.expectEditor.toContain(`|> line([-11.73, 5.35], %)`)
      await startProfile1()
      await editor.expectEditor.toContain(
        `|> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`,
        { shouldNormalise: true }
      )
      await page.waitForTimeout(100)
    })

    await test.step('Without unequipping from the last step, make another profile, and one that is not closed', async () => {
      await startProfile2()
      await editor.expectEditor.toContain(
        `profile002 = startProfileAt([12.34, 11.53], sketch001)`
      )
      await profile2Point2()
      await editor.expectEditor.toContain(`|> line([9.43, -0.68], %)`)
      await profile2Point3()
      await editor.expectEditor.toContain(`|> line([2.17, -5.97], %)`)
    })

    await test.step('create two circles in a row without unequip', async () => {
      await toolbar.circleBtn.click()

      await circle1Center()
      await page.waitForTimeout(100)
      await circle1Radius({ delay: 500 })
      await editor.expectEditor.toContain(
        `profile003 = circle({ center = [16.41, 6.98], radius = 2.5 }, sketch001)`
      )

      await test.step('hover in empty space to wait for overlays to get out of the way', async () => {
        await page.mouse.move(951, 223)
        await page.waitForTimeout(1000)
      })

      await circle2Center()
      await page.waitForTimeout(100)
      await circle2Radius()
      await editor.expectEditor.toContain(
        `profile004 = circle({ center = [23.74, 1.9], radius = 0.72 }, sketch001)`
      )
    })
    await test.step('create two corner rectangles in a row without unequip', async () => {
      await toolbar.rectangleBtn.click()

      await crnRect1point1()
      await editor.expectEditor.toContain(
        `profile005 = startProfileAt([5.63, 3.05], sketch001)`
      )
      await crnRect1point2()
      await editor.expectEditor
        .toContain(`|> angledLine([0, 2.37], %, $rectangleSegmentA001)
  |> angledLine([segAng(rectangleSegmentA001) - 90, 7.8], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`)
      await page.waitForTimeout(100)

      await crnRect2point1()
      await editor.expectEditor.toContain(
        `profile006 = startProfileAt([11.05, 2.37], sketch001)`
      )
      await crnRect2point2()
      await editor.expectEditor
        .toContain(`|> angledLine([0, 5.49], %, $rectangleSegmentA002)
  |> angledLine([
       segAng(rectangleSegmentA002) - 90,
       4.14
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA002),
       -segLen(rectangleSegmentA002)
     ], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`)
    })

    await test.step('create two center rectangles in a row without unequip', async () => {
      await toolbar.selectCenterRectangle()

      await cntrRect1point1()
      await editor.expectEditor.toContain(
        `profile007 = startProfileAt([8.41, -9.29], sketch001)`
      )
      await cntrRect1point2()
      await editor.expectEditor
        .toContain(`|> angledLine([0, 7.06], %, $rectangleSegmentA003)
|> angledLine([
     segAng(rectangleSegmentA003) + 90,
     4.34
   ], %)
|> angledLine([
     segAng(rectangleSegmentA003),
     -segLen(rectangleSegmentA003)
   ], %)
|> lineTo([profileStartX(%), profileStartY(%)], %)
|> close(%)`)
      await page.waitForTimeout(100)

      await cntrRect2point1()
      await editor.expectEditor.toContain(
        `profile008 = startProfileAt([19.33, -5.56], sketch001)`
      )
      await cntrRect2point2()
      await editor.expectEditor
        .toContain(`|> angledLine([0, 3.12], %, $rectangleSegmentA004)
|> angledLine([
     segAng(rectangleSegmentA004) + 90,
     6.24
   ], %)
|> angledLine([
     segAng(rectangleSegmentA004),
     -segLen(rectangleSegmentA004)
   ], %)
|> lineTo([profileStartX(%), profileStartY(%)], %)
|> close(%)`)
    })
  })

  test('Can edit a sketch with multiple profiles, dragging segments to edit them, and adding one new profile', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([6.24, 4.54], sketch001)
  |> line([-0.41, 6.99], %)
  |> line([8.61, 0.74], %)
  |> line([10.99, -5.22], %)
profile002 = startProfileAt([11.19, 5.02], sketch001)
  |> angledLine([0, 10.78], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       4.14
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile003 = circle({ center = [6.92, -4.2], radius = 3.16 }, sketch001)
`
      )
    })

    await homePage.goToModelingScene()

    const [pointOnSegment] = scene.makeMouseHelpers(590, 141)
    const [profileEnd] = scene.makeMouseHelpers(970, 105)
    const profileEndMv = scene.makeMouseHelpers(951, 101)[1]
    const [newProfileEnd] = scene.makeMouseHelpers(764, 104)
    const dragSegmentTo = scene.makeMouseHelpers(850, 104)[1]

    const rectHandle = scene.makeMouseHelpers(901, 150)[1]
    const rectDragTo = scene.makeMouseHelpers(901, 180)[1]

    const circleEdge = scene.makeMouseHelpers(691, 331)[1]
    const dragCircleTo = scene.makeMouseHelpers(720, 331)[1]

    const [rectStart] = scene.makeMouseHelpers(794, 322)
    const [rectEnd] = scene.makeMouseHelpers(757, 395)

    await test.step('enter sketch and setup', async () => {
      await pointOnSegment({ shouldDbClick: true })
      await page.waitForTimeout(600)

      await toolbar.lineBtn.click()
      await page.waitForTimeout(100)
    })

    await test.step('extend existing profile', async () => {
      await profileEnd()
      await page.waitForTimeout(100)
      await newProfileEnd()
      await editor.expectEditor.toContain(`|> line([-11.4, 0.71], %)`)
      await toolbar.lineBtn.click()
      await page.waitForTimeout(100)
    })

    await test.step('edit existing profile', async () => {
      await profileEndMv()
      await page.mouse.down()
      await dragSegmentTo()
      await page.mouse.up()
      await editor.expectEditor.toContain(`line([4.16, -4.51], %)`)
    })

    await test.step('edit existing rect', async () => {
      await rectHandle()
      await page.mouse.down()
      await rectDragTo()
      await page.mouse.up()
      await editor.expectEditor.toContain(
        `angledLine([-7, 10.2], %, $rectangleSegmentA001)`
      )
    })

    await test.step('edit existing circl', async () => {
      await circleEdge()
      await page.mouse.down()
      await dragCircleTo()
      await page.mouse.up()
      await editor.expectEditor.toContain(
        `profile003 = circle({ center = [6.92, -4.2], radius = 4.77 }, sketch001)`
      )
    })

    await test.step('add new profile', async () => {
      await toolbar.rectangleBtn.click()
      await page.waitForTimeout(100)
      await rectStart()
      await editor.expectEditor.toContain(
        `profile004 = startProfileAt([15.62, -3.83], sketch001)`
      )
      await page.waitForTimeout(100)
      await rectEnd()
      await editor.expectEditor
        .toContain(`|> angledLine([180, 1.97], %, $rectangleSegmentA002)
    |> angledLine([
         segAng(rectangleSegmentA002) + 90,
         3.88
       ], %)
    |> angledLine([
         segAng(rectangleSegmentA002),
         -segLen(rectangleSegmentA002)
       ], %)
    |> lineTo([profileStartX(%), profileStartY(%)], %)
    |> close(%)`)
    })
  })
  test('Can delete a profile in the editor while is sketch mode, and sketch mode does not break, can ctrl+z to undo after constraint with variable was added', async ({
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
        `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([6.24, 4.54], sketch001)
  |> line([-0.41, 6.99], %)
  |> line([8.61, 0.74], %)
  |> line([10.99, -5.22], %)
profile002 = startProfileAt([11.19, 5.02], sketch001)
  |> angledLine([0, 10.78], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       4.14
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile003 = circle({ center = [6.92, -4.2], radius = 3.16 }, sketch001)
`
      )
    })

    await homePage.goToModelingScene()

    const [pointOnSegment] = scene.makeMouseHelpers(590, 141)
    const [segment1Click] = scene.makeMouseHelpers(616, 131)
    const sketchIsDrawnProperly = async () => {
      await test.step('check the sketch is still drawn properly', async () => {
        await page.waitForTimeout(200)
        await scene.expectPixelColor([255, 255, 255], { x: 617, y: 163 }, 15)
        await scene.expectPixelColor([255, 255, 255], { x: 629, y: 331 }, 15)
      })
    }

    await test.step('enter sketch and setup', async () => {
      await pointOnSegment({ shouldDbClick: true })
      await page.waitForTimeout(600)

      await toolbar.lineBtn.click()
      await page.waitForTimeout(100)
    })

    await test.step('select and delete code for a profile', async () => {})
    await page.getByText('close(%)').click()
    await page.keyboard.down('Shift')
    for (let i = 0; i < 11; i++) {
      await page.keyboard.press('ArrowUp')
    }
    await page.keyboard.press('Home')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')

    await sketchIsDrawnProperly()

    await test.step('add random new var between profiles', async () => {
      await page.keyboard.type('myVar = 5')
      await page.keyboard.press('Enter')
      await page.waitForTimeout(600)
    })

    await sketchIsDrawnProperly()

    await test.step('Adding a constraint with a variable, and than ctrl-z-ing which will remove the variable again does not break sketch mode', async () => {
      await expect(async () => {
        await segment1Click()
        await editor.expectState({
          diagnostics: [],
          activeLines: ['|>line([-0.41,6.99],%)'],
          highlightedCode: 'line([-0.41,6.99],%)',
        })
      }).toPass({ timeout: 5_000, intervals: [500] })

      await toolbar.lengthConstraintBtn.click()
      await cmdBar.progressCmdBar()
      await editor.expectEditor.toContain('length001 = 7')

      // wait for execute defer
      await page.waitForTimeout(600)
      await sketchIsDrawnProperly()

      await page.keyboard.down('Meta')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('Meta')

      await editor.expectEditor.not.toContain('length001 = 7')
      await sketchIsDrawnProperly()
    })
  })

  test('can enter sketch when there is an extrude', async ({
    homePage,
    scene,
    toolbar,
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([-63.43, 193.08], sketch001)
  |> line([168.52, 149.87], %)
  |> line([190.29, -39.18], %)
  |> tangentialArcTo([319.63, 129.65], %)
  |> line([-217.65, -21.76], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile003 = startProfileAt([16.79, 38.24], sketch001)
  |> angledLine([0, 182.82], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       105.71
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile004 = circle({
  center = [280.45, 47.57],
  radius = 55.26
}, sketch001)
extrude002 = extrude(50, profile001)
extrude001 = extrude(5, profile003)
`
      )
    })

    await homePage.goToModelingScene()

    const [pointOnSegment] = scene.makeMouseHelpers(574, 207)

    await pointOnSegment()
    await toolbar.editSketch()
    // wait for engine animation
    await page.waitForTimeout(600)

    await test.step('check the sketch is still drawn properly', async () => {
      await scene.expectPixelColor([255, 255, 255], { x: 591, y: 167 }, 15)
      await scene.expectPixelColor([255, 255, 255], { x: 638, y: 222 }, 15)
      await scene.expectPixelColor([255, 255, 255], { x: 756, y: 214 }, 15)
    })
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
      localStorage.setItem('persistCode', `myVar = 5`)
    })

    await homePage.goToModelingScene()

    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)

    await toolbar.startSketchPlaneSelection()
    await selectXZPlane()
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)

    await editor.expectEditor.toContain(`sketch001 = startSketchOn('XZ')`)
    await toolbar.exitSketchBtn.click()

    await editor.expectEditor.not.toContain(`sketch001 = startSketchOn('XZ')`)

    await test.step("still renders code, hasn't got into a weird state", async () => {
      await editor.replaceCode(
        'myVar = 5',
        `myVar = 5
  sketch001 = startSketchOn('XZ')
  profile001 = circle({
    center = [12.41, 3.87],
    radius = myVar
  }, sketch001)`
      )

      await scene.expectPixelColor([255, 255, 255], { x: 633, y: 211 }, 15)
    })
  })
  test('A sketch with only "startProfileAt" and no segments should still be able to be continued', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([85.19, 338.59], sketch001)
  |> line([213.3, -94.52], %)
  |> line([-230.09, -55.34], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
sketch002 = startSketchOn('XY')
profile002 = startProfileAt([85.81, 52.55], sketch002)

`
      )
    })

    await homePage.goToModelingScene()

    const [startProfileAt] = scene.makeMouseHelpers(606, 184)
    const [nextPoint] = scene.makeMouseHelpers(763, 130)
    await page.getByText('startProfileAt([85.81, 52.55], sketch002)').click()
    await toolbar.editSketch()
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)

    // equip line tool
    await toolbar.lineBtn.click()
    await page.waitForTimeout(100)
    await startProfileAt()
    await page.waitForTimeout(100)
    await nextPoint()
    await editor.expectEditor.toContain(`|> line([126.05, 44.12], %)`)
  })
  test('old style sketch all in one pipe (with extrude) will break up to allow users to add a new profile to the same sketch', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `thePart = startSketchOn('XZ')
  |> startProfileAt([7.53, 10.51], %)
  |> line([12.54, 1.83], %)
  |> line([6.65, -6.91], %)
  |> line([-6.31, -8.69], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(75, thePart)
`
      )
    })

    await homePage.goToModelingScene()

    const [objClick] = scene.makeMouseHelpers(565, 343)
    const [profilePoint1] = scene.makeMouseHelpers(609, 289)
    const [profilePoint2] = scene.makeMouseHelpers(714, 389)

    await test.step('enter sketch and setup', async () => {
      await objClick()
      await toolbar.editSketch()
      // timeout wait for engine animation is unavoidable
      await page.waitForTimeout(600)
    })

    await test.step('expect code to match initial conditions still', async () => {
      await editor.expectEditor.toContain(`thePart = startSketchOn('XZ')
    |> startProfileAt([7.53, 10.51], %)`)
    })

    await test.step('equiping the line tool should break up the pipe expression', async () => {
      await toolbar.lineBtn.click()
      await editor.expectEditor.toContain(
        `sketch001 = startSketchOn('XZ')thePart = startProfileAt([7.53, 10.51], sketch001)`
      )
    })

    await test.step('can continue on to add a new profile to this sketch', async () => {
      await profilePoint1()
      await editor.expectEditor.toContain(
        `profile001 = startProfileAt([19.77, -7.08], sketch001)`
      )
      await profilePoint2()
      await editor.expectEditor.toContain(`|> line([19.05, -18.14], %)`)
    })
  })
  test('Can enter sketch on sketch of wall and cap for segment, solid2d, extrude-wall, extrude-cap selections', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
  }) => {
    // TODO this test should include a test for selecting revolve walls and caps

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([6.71, -3.66], sketch001)
  |> line([2.65, 9.02], %, $seg02)
  |> line([3.73, -9.36], %, $seg01)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude001 = extrude(20, profile001)
sketch002 = startSketchOn(extrude001, seg01)
profile002 = startProfileAt([0.75, 13.46], sketch002)
  |> line([4.52, 3.79], %)
  |> line([5.98, -2.81], %)
profile003 = startProfileAt([3.19, 13.3], sketch002)
  |> angledLine([0, 6.64], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       2.81
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile004 = startProfileAt([3.15, 9.39], sketch002)
  |> xLine(6.92, %)
  |> line([-7.41, -2.85], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile005 = circle({ center = [5.15, 4.34], radius = 1.66 }, sketch002)
profile006 = startProfileAt([9.65, 3.82], sketch002)
  |> line([2.38, 5.62], %)
  |> line([2.13, -5.57], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
revolve001 = revolve({
  angle = 45,
  axis = getNextAdjacentEdge(seg01)
}, profile004)
extrude002 = extrude(4, profile006)
sketch003 = startSketchOn('-XZ')
profile007 = startProfileAt([4.8, 7.55], sketch003)
  |> line([7.39, 2.58], %)
  |> line([7.02, -2.85], %)
profile008 = startProfileAt([5.54, 5.49], sketch003)
  |> line([6.34, 2.64], %)
  |> line([6.33, -2.96], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile009 = startProfileAt([5.23, 1.95], sketch003)
  |> line([6.8, 2.17], %)
  |> line([7.34, -2.75], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
profile010 = circle({
  center = [7.18, -2.11],
  radius = 2.67
}, sketch003)
profile011 = startProfileAt([5.07, -6.39], sketch003)
  |> angledLine([0, 4.54], %, $rectangleSegmentA002)
  |> angledLine([
       segAng(rectangleSegmentA002) - 90,
       4.17
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA002),
       -segLen(rectangleSegmentA002)
     ], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
extrude003 = extrude(2.5, profile011)
revolve002 = revolve({ angle = 45, axis = seg02 }, profile008)
`
      )
    })

    await homePage.goToModelingScene()

    const camPositionForSelectingSketchOnWallProfiles = () =>
      scene.moveCameraTo(
        { x: 834, y: -680, z: 534 },
        { x: -54, y: -476, z: 148 }
      )
    const camPositionForSelectingSketchOnCapProfiles = () =>
      scene.moveCameraTo({ x: 404, y: 690, z: 38 }, { x: 16, y: -140, z: -10 })
    const wallSelectionOptions = [
      {
        title: 'select wall segment',
        selectClick: scene.makeMouseHelpers(598, 211)[0],
      },
      {
        title: 'select wall solid 2d',
        selectClick: scene.makeMouseHelpers(677, 236)[0],
      },
      {
        title: 'select wall circle',
        selectClick: scene.makeMouseHelpers(811, 247)[0],
      },
      {
        title: 'select wall extrude wall',
        selectClick: scene.makeMouseHelpers(793, 136)[0],
      },
      {
        title: 'select wall extrude cap',
        selectClick: scene.makeMouseHelpers(836, 103)[0],
      },
    ] as const
    const capSelectionOptions = [
      {
        title: 'select cap segment',
        selectClick: scene.makeMouseHelpers(688, 91)[0],
      },
      {
        title: 'select cap solid 2d',
        selectClick: scene.makeMouseHelpers(733, 204)[0],
      },
      // TODO keeps failing
      // {
      //   title: 'select cap circle',
      //   selectClick: scene.makeMouseHelpers(679, 290)[0],
      // },
      {
        title: 'select cap extrude wall',
        selectClick: scene.makeMouseHelpers(649, 402)[0],
      },
      {
        title: 'select cap extrude cap',
        selectClick: scene.makeMouseHelpers(693, 408)[0],
      },
    ] as const

    const verifyWallProfilesAreDrawn = async () =>
      test.step('verify wall profiles are drawn', async () => {
        // open polygon
        await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 599, y: 168 }, 15)
        // closed polygon
        await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 656, y: 171 }, 15)
        // revolved profile
        await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 655, y: 264 }, 15)
        // extruded profile
        await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 808, y: 396 }, 15)
        // circle
        await scene.expectPixelColor(
          [
            TEST_COLORS.WHITE,
            TEST_COLORS.BLUE, // When entering via the circle, it's selected and therefore blue
          ],
          { x: 742, y: 386 },
          15
        )
      })

    const verifyCapProfilesAreDrawn = async () =>
      test.step('verify wall profiles are drawn', async () => {
        // open polygon
        await scene.expectPixelColor(
          TEST_COLORS.WHITE,
          // TEST_COLORS.BLUE, // When entering via the circle, it's selected and therefore blue
          { x: 620, y: 58 },
          15
        )
        // revolved profile
        await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 641, y: 110 }, 15)
        // closed polygon
        await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 632, y: 200 }, 15)
        // extruded profile
        await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 628, y: 410 }, 15)
        // circle
        await scene.expectPixelColor(
          [
            TEST_COLORS.WHITE,
            TEST_COLORS.BLUE, // When entering via the circle, it's selected and therefore blue
          ],
          { x: 681, y: 303 },
          15
        )
      })

    await test.step('select wall profiles', async () => {
      for (const { title, selectClick } of wallSelectionOptions) {
        await test.step(title, async () => {
          await camPositionForSelectingSketchOnWallProfiles()
          await selectClick()
          await toolbar.editSketch()
          await page.waitForTimeout(600)
          await verifyWallProfilesAreDrawn()
          await toolbar.exitSketchBtn.click()
          await page.waitForTimeout(100)
        })
      }
    })

    await test.step('select cap profiles', async () => {
      for (const { title, selectClick } of capSelectionOptions) {
        await test.step(title, async () => {
          await camPositionForSelectingSketchOnCapProfiles()
          await page.waitForTimeout(100)
          await selectClick()
          await page.waitForTimeout(100)
          await toolbar.editSketch()
          await page.waitForTimeout(600)
          await verifyCapProfilesAreDrawn()
          await toolbar.exitSketchBtn.click()
          await page.waitForTimeout(100)
        })
      }
    })
  })
  test('Can enter sketch loft edges, base and continue sketch', async ({
    homePage,
    scene,
    toolbar,
    editor,
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([34, 42.66], sketch001)
  |> line([102.65, 151.99], %)
  |> line([76, -138.66], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
plane001 = offsetPlane('XZ', 50)
sketch002 = startSketchOn(plane001)
profile002 = startProfileAt([39.43, 172.21], sketch002)
  |> xLine(183.99, %)
  |> line([-77.95, -145.93], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)

loft([profile001, profile002])
`
      )
    })

    await homePage.goToModelingScene()
    const [baseProfileEdgeClick] = scene.makeMouseHelpers(621, 292)

    const [rect1Crn1] = scene.makeMouseHelpers(592, 283)
    const [rect1Crn2] = scene.makeMouseHelpers(797, 268)

    await baseProfileEdgeClick()
    await toolbar.editSketch()
    await page.waitForTimeout(600)
    await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 562, y: 172 }, 15)

    await toolbar.rectangleBtn.click()
    await page.waitForTimeout(100)
    await rect1Crn1()
    await editor.expectEditor.toContain(
      `profile003 = startProfileAt([50.72, -18.19], sketch001)`
    )
    await rect1Crn2()
    await editor.expectEditor.toContain(
      `angledLine([0, 113.01], %, $rectangleSegmentA001)`
    )
  })
  test('Can enter sketch loft edges offsetPlane and continue sketch', async ({
    scene,
    toolbar,
    editor,
    page,
    homePage,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
profile001 = startProfileAt([34, 42.66], sketch001)
  |> line([102.65, 151.99], %)
  |> line([76, -138.66], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
plane001 = offsetPlane('XZ', 50)
sketch002 = startSketchOn(plane001)
profile002 = startProfileAt([39.43, 172.21], sketch002)
  |> xLine(183.99, %)
  |> line([-77.95, -145.93], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)

loft([profile001, profile002])
`
      )
    })

    await homePage.goToModelingScene()

    const topProfileEdgeClickCoords = { x: 602, y: 185 } as const
    const [topProfileEdgeClick] = scene.makeMouseHelpers(
      topProfileEdgeClickCoords.x,
      topProfileEdgeClickCoords.y
    )

    const [rect1Crn1] = scene.makeMouseHelpers(592, 283)
    const [rect1Crn2] = scene.makeMouseHelpers(797, 268)

    await scene.moveCameraTo(
      { x: 8171, y: -7740, z: 1624 },
      { x: 3302, y: -627, z: 2892 }
    )

    await topProfileEdgeClick()
    await toolbar.editSketch()
    await page.waitForTimeout(600)
    await scene.expectPixelColor(TEST_COLORS.BLUE, { x: 788, y: 188 }, 15)

    await toolbar.rectangleBtn.click()
    await page.waitForTimeout(100)
    await rect1Crn1()
    await editor.expectEditor.toContain(
      `profile003 = startProfileAt([47.76, -17.13], plane001)`
    )
    await rect1Crn2()
    await editor.expectEditor.toContain(
      `angledLine([0, 106.42], %, $rectangleSegmentA001)`
    )
  })
})
// Regression test for https://github.com/KittyCAD/modeling-app/issues/4891
test.describe(`Click based selection don't brick the app when clicked out of range after format using cache`, () => {
  test(`Can select a line that reformmed after entering sketch mode`, async ({
    context,
    page,
    scene,
    toolbar,
    editor,
    homePage,
  }) => {
    // We seed the scene with a single offset plane
    await context.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([3.14, 3.14], %)
  |> arcTo({
  end = [4, 2],
  interior = [1, 2]
  }, %)
`
      )
    })

    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    await test.step(`format the code`, async () => {
      // doesn't contain condensed version
      await editor.expectEditor.not.toContain(
        `arcTo({ end = [4, 2], interior = [1, 2] }, %)`
      )
      // click the code to enter sketch mode
      await page.getByText(`arcTo`).click()
      // Format the code.
      await page.locator('#code-pane button:first-child').click()
      await page.locator('button:has-text("Format code")').click()
    })

    await test.step(`Ensure the code reformatted`, async () => {
      await editor.expectEditor.toContain(
        `arcTo({ end = [4, 2], interior = [1, 2] }, %)`
      )
    })

    const [arcClick, arcHover] = scene.makeMouseHelpers(699, 337)
    await test.step('Ensure we can hover the arc', async () => {
      await arcHover()

      // Check that the code is highlighted
      await editor.expectState({
        activeLines: ["sketch001=startSketchOn('XZ')"],
        diagnostics: [],
        highlightedCode: 'arcTo({end = [4, 2], interior = [1, 2]}, %)',
      })
    })

    await test.step('reset the selection', async () => {
      // Move the mouse out of the way
      await page.mouse.move(655, 337)

      await editor.expectState({
        activeLines: ["sketch001=startSketchOn('XZ')"],
        diagnostics: [],
        highlightedCode: '',
      })
    })

    await test.step('Ensure we can click the arc', async () => {
      await arcClick()

      // Check that the code is highlighted
      await editor.expectState({
        activeLines: [],
        diagnostics: [],
        highlightedCode: 'arcTo({end = [4, 2], interior = [1, 2]}, %)',
      })
    })
  })
})
