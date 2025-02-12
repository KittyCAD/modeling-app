import { test, expect, Page } from './zoo-test'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HomePageFixture } from './fixtures/homePageFixture'

import {
  getMovementUtils,
  getUtils,
  PERSIST_MODELING_CONTEXT,
} from './test-utils'
import { uuidv4, roundOff } from 'lib/utils'
import { SceneFixture } from './fixtures/sceneFixture'

test.describe('Sketch tests', { tag: ['@skipWin'] }, () => {
  test('multi-sketch file shows multiple Edit Sketch buttons', async ({
    page,
    context,
    homePage,
    scene,
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
        angleStart = 0,
        angleEnd = 360
      }, %)

    part001 = startSketchOn('XY')
  ${startProfileAt2}
  |> xLine(width * .5, %)
  |> yLine(height, %)
  |> xLine(-width * .5, %)
  |> close()
  |> hole(screwHole, %)
  |> extrude(length = thickness)

  part002 = startSketchOn('-XZ')
  ${startProfileAt3}
  |> xLine(width / 4, %)
  |> tangentialArcTo([width / 2, 0], %)
  |> xLine(-width / 4 + wireRadius, %)
  |> yLine(wireOffset, %)
  |> arc({
        radius = wireRadius,
        angleStart = 0,
        angleEnd = 180
      }, %)
  |> yLine(-wireOffset, %)
  |> xLine(-width / 4, %)
  |> close()
  |> extrude(length = -height)
    `
        )
      },
      selectionsSnippets
    )
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

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
    homePage,
    scene,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
    |> startProfileAt([4.61, -14.01], %)
    |> xLine(12.73, %)
    |> tangentialArcTo([24.95, -5.38], %)`
      )
    })

    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

    await expect(async () => {
      await page.getByText('tangentialArcTo([24.95, -5.38], %)').click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeEnabled({ timeout: 2000 })
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
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'line Line', exact: true }).click()
    await page.waitForTimeout(100)

    await expect(async () => {
      await page.mouse.move(700, 200, { steps: 25 })
      await page.mouse.click(700, 200)

      await expect
        .poll(u.crushKclCodeIntoOneLineAndThenMaybeSome, { timeout: 1000 })
        .toBe(
          `sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.61,-14.01], %)
  |> yLine(15.95, %)
`
            .replaceAll(' ', '')
            .replaceAll('\n', '')
        )
    }).toPass({ timeout: 40_000, intervals: [1_000] })
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
      openPanes: string[],
      scene: SceneFixture
    ) => {
      // Load the app with the code panes
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn('XZ')
      |> startProfileAt([4.61, -14.01], %)
      |> line(end = [12.73, -0.09])
      |> tangentialArcTo([24.95, -5.38], %)
      |> close()`
        )
      })

      const u = await getUtils(page)
      await homePage.goToModelingScene()
      await scene.waitForExecutionDone()

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
      |> line(end = [12.73, -0.09])
      |> tangentialArcTo([24.95, -5.38], %)
      |> close()`)
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

      // drag startProfileAt handle
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
      |> line(end = [14.72, 1.97])
      |> tangentialArcTo([24.95, -5.38], %)
      |> line(end = [1.97, 2.06])
      |> close()`)
    }
    test(
      'code pane open at start-handles',
      { tag: ['@skipWin'] },
      async ({ page, homePage, scene }) => {
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
        await doEditSegmentsByDraggingHandle(page, homePage, ['code'], scene)
      }
    )

    test(
      'code pane closed at start-handles',
      { tag: ['@skipWin'] },
      async ({ page, homePage, scene }) => {
        // Load the app with the code panes
        await page.addInitScript(async (persistModelingContext) => {
          localStorage.setItem(
            persistModelingContext,
            JSON.stringify({ openPanes: [] })
          )
        }, PERSIST_MODELING_CONTEXT)
        await doEditSegmentsByDraggingHandle(page, homePage, [], scene)
      }
    )
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
  |> line(end = [12.73, -0.09])
  |> tangentialArcTo([24.95, -0.38], %)
  |> close()
  |> extrude(length = 5)`
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
    |> line(end = [12.68, -1.09])
    |> tangentialArcTo([24.89, 0.68], %)
    |> close()
    |> extrude(length = 5)
  `)
  })

  test('Can edit a sketch that has been revolved in the same pipe', async ({
    page,
    homePage,
    scene,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
  |> startProfileAt([4.61, -14.01], %)
  |> line(end = [12.73, -0.09])
  |> tangentialArcTo([24.95, -5.38], %)
  |> close()
  |> revolve({ axis = "X",}, %)`
      )
    })

    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

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

    // drag startProfileAt handle
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
  |> line(end = [14.72, 1.97])
  |> tangentialArcTo([24.95, -5.38], %)
  |> line(end = [1.97, 2.06])
  |> close()
  |> revolve({ axis = "X" }, %)`)
  })
  test('Can add multiple sketches', async ({ page, homePage }) => {
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
    codeStr += `  |> startProfileAt(${toSU([0, 0])}, %)`
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
    codeStr += `  |> startProfileAt([2.03, 0], %)`
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
    |> startProfileAt([${roundOff(scale * 69.6)}, ${roundOff(scale * 34.8)}], %)
    |> xLine(${roundOff(scale * 139.19)}, %)
    |> yLine(-${roundOff(scale * 139.2)}, %)
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
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XZ')
    |> startProfileAt([-0.45, 0.87], %)
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

    // click "line(end = [1.32, 0.38])"
    await page.getByText(`line(end = [1.32, 0.38])`).click()
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
      page.getByRole('button', { name: 'selection : 1 segment', exact: false })
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
    |> line(end = [1.32, 0.38])
    |> line(end = [1.02, -1.32], tag = $seg01)
    |> line(end = [-1.01, -0.77])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(sketch001, length = 5)
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

    // Click the end face of extrude001
    await page.mouse.click(622, 355)

    // The click should generate a new sketch starting on the end face of extrude001
    // signified by the implicit 'END' tag for that solid.
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
    |> line(end = [1.32, 0.38])
    |> line(end = [1.02, -1.32], tag = $seg01)
    |> line(end = [-1.01, -0.77])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(sketch001, length = 5)
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
    |> line(end = [20, 0])
    |> line(end = [0, 20])
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
    |> line(end = [3.39, -3.39])
  `)

      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn('XZ')
    |> startProfileAt([11.8, 9.09], %)
    |> line(end = [3.39, -3.39])
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
          |> close()
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
    |> line(endAbsolute = [
     railTop / 2,
     railClampable + railBaseLength
   ])
    |> line(endAbsolute = [
     railWideWidth / 2,
     railClampable / 2 + railBaseLength
   ], $seg01)
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
      const arrowHeadWhite: [number, number, number] = [255, 255, 255]
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
        await editor.replaceCode('line(endAbsolute = [pro', 'badBadBadFn([pro')
        await editor.expectState({
          activeLines: [],
          diagnostics: ['memoryitemkey`badBadBadFn`isnotdefined'],
          highlightedCode: '',
        })
        // this checks sketch segments have failed to be drawn
        await verifyArrowHeadColor(backgroundGray)
      })

      await test.step('', async () => {
        await editor.replaceCode('badBadBadFn([pro', 'line(endAbsolute = [pro')
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
        `offsetPlane001 = offsetPlane("XY", offset = 10)`
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
          highlightedCode: 'offsetPlane("XY", offset = 10)',
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
  |> line(end = [3.14, 3.14])
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

// Regression test for https://github.com/KittyCAD/modeling-app/issues/4372
test.describe('Redirecting to home page and back to the original file should clear sketch DOM elements', () => {
  test('Can redirect to home page and back to original file and have a cleared DOM', async ({
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
        ` sketch001 = startSketchOn('XZ')
|> startProfileAt([256.85, 14.41], %)
|> line(endAbsolute = [0, 211.07])
`
      )
    })
    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()

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
})
