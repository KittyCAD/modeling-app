import type { Page } from '@playwright/test'
import { roundOff, uuidv4 } from '@src/lib/utils'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import {
  PERSIST_MODELING_CONTEXT,
  TEST_COLORS,
  getMovementUtils,
  getUtils,
  orRunWhenFullSuiteEnabled,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Sketch tests', { tag: ['@skipWin'] }, () => {
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

    screwHole = startSketchOn(XY)
  ${startProfileAt1}
  |> arc({
        radius = screwRadius,
        angleStart = 0,
        angleEnd = 360
      }, %)

    part001 = startSketchOn(XY)
  ${startProfileAt2}
  |> xLine(length = width * .5)
  |> yLine(length = height)
  |> xLine(length = -width * .5)
  |> close()
  |> hole(screwHole, %)
  |> extrude(length = thickness)

  part002 = startSketchOn(-XZ)
  ${startProfileAt3}
  |> xLine(length = width / 4)
  |> tangentialArcTo([width / 2, 0], %)
  |> xLine(length = -width / 4 + wireRadius)
  |> yLine(length = wireOffset)
  |> arc({
        radius = wireRadius,
        angleStart = 0,
        angleEnd = 180
      }, %)
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
  test('Can delete most of a sketch and the line tool will still work', async ({
    page,
    scene,
    homePage,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> startProfileAt([2.61, -4.01], %)
  |> xLine(length = 8.73)
  |> tangentialArcTo([8.33, -1.31], %)`
      )
    })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 587, y: 270 }, 15)

    await expect(async () => {
      await page.mouse.click(700, 200)
      await page.getByText('tangentialArcTo([8.33, -1.31], %)').click()
      await expect(
        page.getByRole('button', { name: 'Edit Sketch' })
      ).toBeEnabled({ timeout: 2000 })
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
        .toBe(`@settings(defaultLengthUnit = in)


sketch002 = startSketchOn(XZ)
sketch001 = startProfileAt([12.34, -12.34], sketch002)
  |> yLine(length = 12.34)

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
  test('Can edit segments by dragging their handles', () => {
    test.fixme(orRunWhenFullSuiteEnabled())
    const doEditSegmentsByDraggingHandle = async (
      page: Page,
      homePage: HomePageFixture,
      openPanes: string[],
      scene: SceneFixture,
      toolbar: ToolbarFixture,
      cmdBar: CmdBarFixture
    ) => {
      // Load the app with the code panes
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn(XZ)
      |> startProfileAt([4.61, -14.01], %)
      |> line(end = [12.73, -0.09])
      |> tangentialArcTo([24.95, -5.38], %)
      |> arcTo({
          interior = [20.18, -1.7],
          end = [11.82, -1.16]
        }, %)
      |> arc({
          radius = 5.92,
          angleStart = -89.36,
          angleEnd = 135.81
        }, %)
      |> close()`
        )
      })

      const u = await getUtils(page)
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

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
        await expect(u.codeLocator).toHaveText(`sketch001 = startSketchOn(XZ)
      |> startProfileAt([4.61, -14.01], %)
      |> line(end = [12.73, -0.09])
      |> tangentialArcTo([24.95, -5.38], %)
      |> arcTo({
          interior = [20.18, -1.7],
          end = [11.82, -1.16]
        }, %)
      |> arc({
          radius = 5.92,
          angleStart = -89.36,
          angleEnd = 135.81
        }, %)
      |> close()
`)
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
      await toolbar.editSketch()
      if (openPanes.includes('code')) {
        prevContent = await page.locator('.cm-content').innerText()
      }

      const step5 = { steps: 5 }

      await expect(page.getByTestId('segment-overlay')).toHaveCount(5)

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

      // drag arcTo interior handle (three point arc)
      const arcToHandle = await u.getBoundingBox('[data-overlay-index="2"]')
      await page.mouse.move(arcToHandle.x, arcToHandle.y - 5)
      await page.mouse.down()
      await page.mouse.move(
        arcToHandle.x - dragPX,
        arcToHandle.y + dragPX,
        step5
      )
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
        prevContent = await page.locator('.cm-content').innerText()
      }

      // drag arcTo end handle (three point arc)
      const arcToEndHandle = await u.getBoundingBox('[data-overlay-index="3"]')
      await page.mouse.move(arcToEndHandle.x, arcToEndHandle.y - 5)
      await page.mouse.down()
      await page.mouse.move(
        arcToEndHandle.x - dragPX,
        arcToEndHandle.y + dragPX,
        step5
      )
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
        prevContent = await page.locator('.cm-content').innerText()
      }

      // drag arc radius handle
      const arcRadiusHandle = await u.getBoundingBox('[data-overlay-index="4"]')
      await page.mouse.move(arcRadiusHandle.x, arcRadiusHandle.y - 5)
      await page.mouse.down()
      await page.mouse.move(
        arcRadiusHandle.x - dragPX,
        arcRadiusHandle.y + dragPX,
        step5
      )
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      }

      // drag arc center handle (we'll have to hardcode the position because it doesn't have a overlay near the handle)
      const arcCenterHandle = { x: 745, y: 214 }
      await page.mouse.move(arcCenterHandle.x, arcCenterHandle.y - 5)
      await page.mouse.down()
      await page.mouse.move(
        arcCenterHandle.x - dragPX,
        arcCenterHandle.y + dragPX,
        step5
      )
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      }

      // Open the code pane
      await u.openKclCodePanel()

      // expect the code to have changed
      await expect(page.locator('.cm-content'))
        .toHaveText(`sketch001 = startSketchOn(XZ)
  |> startProfileAt([6.44, -12.07], %)
  |> line(end = [14.72, 1.97])
  |> tangentialArcTo([26.92, -3.32], %)
  |> arcTo({
       interior = [18.11, -3.73],
       end = [9.77, -3.19]
     }, %)
  |> arc({
       radius = 3.75,
       angleStart = -58.29,
       angleEnd = 161.17
     }, %)
  |> close()
`)
    }
    test(
      'code pane open at start-handles',
      { tag: ['@skipWin'] },
      async ({ page, homePage, scene, toolbar, cmdBar }) => {
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
        await doEditSegmentsByDraggingHandle(
          page,
          homePage,
          ['code'],
          scene,
          toolbar,
          cmdBar
        )
      }
    )

    test(
      'code pane closed at start-handles',
      { tag: ['@skipWin'] },
      async ({ page, homePage, scene, toolbar, cmdBar }) => {
        // Load the app with the code panes
        await page.addInitScript(async (persistModelingContext) => {
          localStorage.setItem(
            persistModelingContext,
            JSON.stringify({ openPanes: [] })
          )
        }, PERSIST_MODELING_CONTEXT)
        await doEditSegmentsByDraggingHandle(
          page,
          homePage,
          [],
          scene,
          toolbar,
          cmdBar
        )
      }
    )
  })

  test('Can edit a circle center and radius by dragging its handles', async ({
    page,
    editor,
    homePage,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit=in)
sketch001 = startSketchOn(XZ)
    |> circle(center = [4.61, -5.01], radius = 8)`
      )
    })

    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

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

    await page.getByText('circle(center = [4.61, -5.01], radius = 8)').click()
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
      `sketch001 = startSketchOn(XZ)
    |> circle(center = [7.26, -2.37], radius = 11.44)`,
      { shouldNormalise: true }
    )
  })
  test('Can edit a sketch that has been extruded in the same pipe', async ({
    page,
    homePage,
    editor,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit=in)
sketch001 = startSketchOn(XZ)
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
    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
    |> startProfileAt([7.12, -12.68], %)
    |> line(end = [12.68, -1.09])
    |> tangentialArcTo([24.89, 0.68], %)
    |> close()
    |> extrude(length = 5)`,
      { shouldNormalise: true }
    )
  })

  test('Can edit a sketch that has been revolved in the same pipe', async ({
    page,
    homePage,
    scene,
    editor,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit=in)
sketch001 = startSketchOn(XZ)
  |> startProfileAt([4.61, -14.01], %)
  |> line(end = [12.73, -0.09])
  |> tangentialArcTo([24.95, -5.38], %)
  |> close()
  |> revolve(axis = X)`
      )
    })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

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
    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
  |> startProfileAt([6.44, -12.07], %)
  |> line(end = [14.72, 1.97])
  |> tangentialArcTo([24.95, -5.38], %)
  |> line(end = [1.97, 2.06])
  |> close()
  |> revolve(axis = X)`,
      { shouldNormalise: true }
    )
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

    let codeStr =
      '@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XY)'

    await page.mouse.click(center.x, viewportSize.height * 0.55)
    await expect(u.codeLocator).toHaveText(codeStr)
    await u.closeDebugPanel()
    await page.waitForTimeout(500) // TODO detect animation ending, or disable animation

    await click00r(0, 0)
    codeStr += `profile001 = startProfileAt(${toSU([0, 0])}, sketch001)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(50, 0)
    await page.waitForTimeout(100)
    codeStr += `  |> xLine(length = ${toU(50, 0)[0]})`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 50)
    codeStr += `  |> yLine(length = ${toU(0, 50)[1]})`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-50, 0)
    codeStr += `  |> xLine(length = ${toU(-50, 0)[0]})`
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
    codeStr += 'sketch002 = startSketchOn(XY)'
    await expect(u.codeLocator).toHaveText(codeStr)
    await u.closeDebugPanel()

    await click00r(30, 0)
    codeStr += `profile002 = startProfileAt([2.03, 0], sketch002)`
    await expect(u.codeLocator).toHaveText(codeStr)

    // TODO: I couldn't use `toSU` here because of some rounding error causing
    // it to be off by 0.01
    await click00r(30, 0)
    codeStr += `  |> xLine(length = 2.04)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(0, 30)
    codeStr += `  |> yLine(length = -2.03)`
    await expect(u.codeLocator).toHaveText(codeStr)

    await click00r(-30, 0)
    codeStr += `  |> xLine(length = -2.04)`
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

      const code = `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(-XZ)
profile001 = startProfileAt([${roundOff(scale * 69.6)}, ${roundOff(
        scale * 34.8
      )}], sketch001)
    |> xLine(length = ${roundOff(scale * 139.19)})
    |> yLine(length = -${roundOff(scale * 139.2)})
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
        `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(-XZ)`
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
    // this was a regression https://github.com/KittyCAD/modeling-app/issues/2832
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
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
        `sketch001 = startSketchOn(XZ)
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
      `sketch001 = startSketchOn(XZ)
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
  test('empty-scene default-planes act as expected', async ({
    page,
    homePage,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
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

    await u.codeLocator.fill(`sketch001 = startSketchOn(XY)
    |> startProfileAt([-10, -10], %)
    |> line(end = [20, 0])
    |> line(end = [0, 20])
    |> xLine(length = -20)
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
    await expect(u.codeLocator).toHaveText(`sketch001 = startSketchOn(XZ)
    |> startProfileAt([11.8, 9.09], %)
    |> line(end = [3.39, -3.39])
  `)

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
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
  })

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
          |> xLine(endAbsolute = 0 + .001)
          |> yLine(endAbsolute = 0)
          |> close()
          |> revolve(axis = Y)

        return lugSketch
      }

      lug([0, 0], 10, .5, XY)`
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

  const rail = startSketchOn(XZ)
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
          './rust/kcl-lib/e2e/executor/inputs/e2e-can-sketch-on-chamfer.kcl'
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
        `@settings(defaultLengthUnit = in)
offsetPlane001 = offsetPlane(XY, offset = 10)`
      )
    })

    await homePage.goToModelingScene()

    const [planeClick, planeHover] = scene.makeMouseHelpers(650, 200)

    await test.step(`Start sketching on the offset plane`, async () => {
      await toolbar.startSketchPlaneSelection()

      await test.step(`Hovering should highlight code`, async () => {
        await planeHover()
        await editor.expectState({
          activeLines: [`@settings(defaultLengthUnit = in)`],
          diagnostics: [],
          highlightedCode: 'offsetPlane(XY, offset = 10)',
        })
      })

      await test.step(`Clicking should select the plane and enter sketch mode`, async () => {
        await planeClick()
        // Have to wait for engine-side animation to finish
        await page.waitForTimeout(600)
        await expect(toolbar.lineBtn).toBeEnabled()
        await editor.expectEditor.toContain('startSketchOn(offsetPlane001)')
        await editor.expectState({
          activeLines: [`@settings(defaultLengthUnit = in)`],
          diagnostics: [],
          highlightedCode: '',
        })
      })
    })
  })
})

test.describe('multi-profile sketching', () => {
  test(
    `test it removes half-finished expressions when changing tools in sketch mode`,
    { tag: ['@skipWin'] },
    async ({ context, page, scene, toolbar, editor, homePage, cmdBar }) => {
      test.fixme(orRunWhenFullSuiteEnabled())
      // We seed the scene with a single offset plane
      await context.addInitScript(() => {
        localStorage.setItem(
          'persistCode',
          `yo = 5
sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([121.52, 168.25], sketch001)
  |> line(end = [115.04, 113.61])
  |> line(end = [130.87, -97.79])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile002 = startProfileAt([117.2, 56.08], sketch001)
  |> line(end = [166.82, 25.89])
  |> yLine(length = -107.86)

`
        )
      })

      const [continueProfile2Clk] = scene.makeMouseHelpers(954, 282)

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      await (await toolbar.getFeatureTreeOperation('Sketch', 0)).dblclick()
      await page.waitForTimeout(600)

      const [circlePoint1] = scene.makeMouseHelpers(700, 200)

      await test.step('equip circle tool and click first point', async () => {
        // await page.waitForTimeout(100)
        await expect
          .poll(async () => {
            await toolbar.circleBtn.click()
            return toolbar.circleBtn.getAttribute('aria-pressed')
          })
          .toBe('true')
        await page.waitForTimeout(100)
        await circlePoint1()
        await editor.expectEditor.toContain(
          'profile003 = circle(sketch001, center = ['
        )
      })

      await test.step('equip line tool and verify circle code is removed', async () => {
        await toolbar.lineBtn.click()
        await editor.expectEditor.not.toContain('profile003 = circle(')
      })

      const [circle3Point1] = scene.makeMouseHelpers(650, 200)
      const [circle3Point2] = scene.makeMouseHelpers(750, 200)
      // const [circle3Point3] = scene.makeMouseHelpers(700, 150)

      await test.step('equip three point circle tool and click first two points', async () => {
        await toolbar.selectCircleThreePoint()
        await page.waitForTimeout(100)
        await circle3Point1()
        await page.waitForTimeout(100)
        await circle3Point2()
        await editor.expectEditor.toContain('profile003 = circleThreePoint(')
      })

      await test.step('equip line tool and verify three-point circle code is removed', async () => {
        await toolbar.lineBtn.click()
        await editor.expectEditor.not.toContain(
          'profile003 = circleThreePoint('
        )
      })

      await test.step('equip three-point-arc tool and click first two points', async () => {
        await page.waitForTimeout(200)
        await toolbar.selectThreePointArc()
        await page.waitForTimeout(200)
        await circle3Point1()
        await page.waitForTimeout(200)
        await circle3Point2()
        await editor.expectEditor.toContain('arcTo({')
      })

      await test.step('equip line tool and verify three-point-arc code is removed after second click', async () => {
        await toolbar.lineBtn.click()
        await editor.expectEditor.not.toContain('arcTo({')
      })

      const [cornerRectPoint1] = scene.makeMouseHelpers(600, 300)

      await test.step('equip corner rectangle tool and click first point', async () => {
        await toolbar.rectangleBtn.click()
        await page.waitForTimeout(100)
        await cornerRectPoint1()
        await editor.expectEditor.toContain('profile004 = startProfileAt(')
      })

      await test.step('equip line tool and verify corner rectangle code is removed', async () => {
        await toolbar.lineBtn.click()
        await editor.expectEditor.not.toContain('profile004 = startProfileAt(')
      })

      const [centerRectPoint1] = scene.makeMouseHelpers(700, 300)

      await test.step('equip center rectangle tool and click first point', async () => {
        await toolbar.selectCenterRectangle()
        await page.waitForTimeout(100)
        await centerRectPoint1()
        await editor.expectEditor.toContain('profile004 = startProfileAt(')
      })

      await test.step('equip line tool and verify center rectangle code is removed', async () => {
        await toolbar.lineBtn.click()
        await editor.expectEditor.not.toContain('profile004 = startProfileAt(')
      })

      await test.step('continue profile002 with the three point arc tool, and then switch back to the line tool to verify it only removes the last expression in the pipe', async () => {
        await toolbar.selectThreePointArc()
        await page.waitForTimeout(200)
        await continueProfile2Clk()
        await page.waitForTimeout(200)
        await circle3Point1()
        await editor.expectEditor.toContain('arcTo({')
        await toolbar.lineBtn.click()
        await editor.expectEditor.not.toContain('arcTo({')
        await editor.expectEditor.toContain('profile002')
      })
    }
  )
  test(
    `snapToProfile start only works for current profile`,
    { tag: ['@skipWin'] },
    async ({ context, page, scene, toolbar, editor, homePage, cmdBar }) => {
      // We seed the scene with a single offset plane
      await context.addInitScript(() => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile002 = startProfileAt([40.68, 87.67], sketch001)
  |> xLine(length = 239.17)
profile003 = startProfileAt([206.63, -56.73], sketch001)
  |> xLine(length = -156.32)
`
        )
      })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      const [onSegmentClick] = scene.makeMouseHelpers(604, 349)
      const [endOfLowerSegClick, endOfLowerSegMove] = scene.makeMouseHelpers(
        697,
        360
      )
      const [profileStartOfHigherSegClick, profileStartOfHigherSegMove] =
        scene.makeMouseHelpers(677, 78)
      const tanArcLocation = { x: 624, y: 340 } as const

      await test.step('enter sketch mode', async () => {
        await onSegmentClick({ shouldDbClick: true })
        await page.waitForTimeout(600)
      })

      const codeFromTangentialArc = `  |> tangentialArcTo([39.49, 88.22], %)`
      await test.step('check that tangential tool does not snap to other profile starts', async () => {
        await toolbar.tangentialArcBtn.click()
        await page.waitForTimeout(1000)
        await endOfLowerSegMove()
        await page.waitForTimeout(1000)
        await endOfLowerSegClick()
        await page.waitForTimeout(1000)
        await profileStartOfHigherSegClick()
        await page.waitForTimeout(1000)
        await editor.expectEditor.toContain(codeFromTangentialArc)
        await editor.expectEditor.not.toContain(
          `[profileStartX(%), profileStartY(%)]`
        )
      })

      await test.step('remove tangential arc code to reset', async () => {
        await scene.expectPixelColor(TEST_COLORS.WHITE, tanArcLocation, 15)
        await editor.replaceCode(codeFromTangentialArc, '')
        // check pixel is now gray at tanArcLocation to verify code has executed
        await scene.expectPixelColor([26, 26, 26], tanArcLocation, 15)
        await editor.expectEditor.not.toContain(
          `tangentialArcTo([39.49, 88.22], %)`
        )
      })

      await test.step('check that tangential tool does snap to current profile start', async () => {
        await expect
          .poll(async () => {
            await toolbar.lineBtn.click()
            return toolbar.lineBtn.getAttribute('aria-pressed')
          })
          .toBe('true')
        await profileStartOfHigherSegMove()
        await endOfLowerSegMove()
        await endOfLowerSegClick()
        await profileStartOfHigherSegClick()
        await editor.expectEditor.toContain('line(end = [-10.82, 144.95])')
        await editor.expectEditor.not.toContain(
          `[profileStartX(%), profileStartY(%)]`
        )
      })
    }
  )
  test('can enter sketch mode for sketch with no profiles', async ({
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
        `sketch001 = startSketchOn(XY)
`
      )
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
    await editor.expectEditor.toContain(`profile001 = startProfileAt`)
    await segment1Clk()
    await editor.expectEditor.toContain(`|> line(end`)
  })
  test('can delete all profiles in sketch mode and user can still equip a tool and draw something', async ({
    scene,
    toolbar,
    editor,
    page,
    homePage,
  }) => {
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)

    await toolbar.startSketchPlaneSelection()
    await selectXZPlane()
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)
    await editor.expectEditor.toContain(`sketch001 = startSketchOn(XZ)`)

    const [startProfile1] = scene.makeMouseHelpers(568, 70)
    const [segment1Clk] = scene.makeMouseHelpers(701, 78)
    const [segment2Clk] = scene.makeMouseHelpers(745, 189)

    await test.step('add two segments', async () => {
      await startProfile1()
      await editor.expectEditor.toContain(
        `profile001 = startProfileAt([4.61, 12.21], sketch001)`
      )
      await segment1Clk()
      await editor.expectEditor.toContain(`|> line(end`)
      await segment2Clk()
      await editor.expectEditor.toContain(`|> line(end = [2.98, -7.52])`)
    })

    await test.step('delete all profiles', async () => {
      await editor.replaceCode('', 'sketch001 = startSketchOn(XZ)\n')
      await page.waitForTimeout(600) // wait for deferred execution
    })

    await test.step('equip circle and draw it', async () => {
      await toolbar.circleBtn.click()
      await page.mouse.click(700, 200)
      await page.mouse.click(750, 200)
      await editor.expectEditor.toContain('circle(sketch001, center = [')
    })
  })
  test('Can add multiple profiles to a sketch (all tool types)', async ({
    scene,
    toolbar,
    editor,
    page,
    homePage,
  }) => {
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

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

    const [circle3Point1p1, circle3Point1p1Move] = scene.makeMouseHelpers(
      630,
      465
    )
    const [circle3Point1p2, circle3Point1p2Move] = scene.makeMouseHelpers(
      673,
      340
    )
    const [circle3Point1p3, circle3Point1p3Move] = scene.makeMouseHelpers(
      734,
      414
    )

    const [circle3Point2p1, circle3Point2p1Move] = scene.makeMouseHelpers(
      876,
      351
    )
    const [circle3Point2p2, circle3Point2p2Move] = scene.makeMouseHelpers(
      875,
      279
    )
    const [circle3Point2p3, circle3Point2p3Move] = scene.makeMouseHelpers(
      834,
      306
    )

    await toolbar.startSketchPlaneSelection()
    await selectXZPlane()
    // timeout wait for engine animation is unavoidable
    await page.waitForTimeout(600)
    await editor.expectEditor.toContain(`sketch001 = startSketchOn(XZ)`)
    await test.step('Create a close profile stopping mid profile to equip the tangential arc, then three-point arc, and then back to the line tool', async () => {
      await startProfile1()
      await editor.expectEditor.toContain(
        `profile001 = startProfileAt([4.61, 12.21], sketch001)`
      )

      await endLineStartTanArc()
      await editor.expectEditor.toContain(`|> line(end = [9.02, -0.55])`)
      await toolbar.tangentialArcBtn.click()
      await page.waitForTimeout(300)
      await page.mouse.click(745, 359)
      await page.waitForTimeout(300)
      await endLineStartTanArc({ delay: 544 })

      await endArcStartLine()
      await editor.expectEditor.toContain(
        `|> tangentialArcTo([16.61, 4.14], %)`
      )

      // Add a three-point arc segment
      await toolbar.selectThreePointArc()
      await page.waitForTimeout(300)

      // select end of profile again
      await endLineStartTanArc()
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
      await editor.expectEditor.toContain(`|> arcTo(`)

      // Switch back to line tool to continue
      await toolbar.lineBtn.click()
      await page.waitForTimeout(300)

      // Continue with the original line segment
      await threePointEnd()
      await page.waitForTimeout(300)

      await page.mouse.click(572, 110)
      await editor.expectEditor.toContain(`|> line(end = [-1.22, 10.85])`)
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
      await editor.expectEditor.toContain(
        `profile002 = startProfileAt([19.12, 11.53], sketch001)`
      )
      await profile2Point2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(`|> line(end = [9.43, -0.68])`)
      await profile2Point3()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(`|> line(end = [2.17, -5.97])`)
    })

    await test.step('create two circles in a row without unequip', async () => {
      await toolbar.circleBtn.click()

      await circle1Center()
      await page.waitForTimeout(300)
      await circle1Radius({ delay: 500 })
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `profile003 = circle(sketch001, center = [23.19, 6.98], radius = 2.5)`
      )

      await test.step('hover in empty space to wait for overlays to get out of the way', async () => {
        await page.mouse.move(951, 223)
        await page.waitForTimeout(1000)
      })

      await circle2Center()
      await page.waitForTimeout(300)
      await circle2Radius()
      await editor.expectEditor.toContain(
        `profile004 = circle(sketch001, center = [23.74, 1.9], radius = 0.72)`
      )
    })
    await test.step('create two corner rectangles in a row without unequip', async () => {
      await expect
        .poll(async () => {
          await toolbar.rectangleBtn.click()
          return toolbar.rectangleBtn.getAttribute('aria-pressed')
        })
        .toBe('true')

      await crnRect1point1()
      await editor.expectEditor.toContain(
        `profile005 = startProfileAt([5.63, 3.05], sketch001)`
      )
      await crnRect1point2()
      await editor.expectEditor.toContain(
        `|> angledLine(angle = 0, length = 2.37, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 7.8)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`.replaceAll('\n', '')
      )

      await crnRect2point1()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `profile006 = startProfileAt([11.05, 2.37], sketch001)`
      )
      await crnRect2point2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `|> angledLine(angle = 0, length = 5.49, tag = $rectangleSegmentA002)
  |> angledLine([
       segAng(rectangleSegmentA002) - 90,
       4.14
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA002),
       -segLen(rectangleSegmentA002)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`.replaceAll('\n', '')
      )
    })

    await test.step('create two center rectangles in a row without unequip', async () => {
      await toolbar.selectCenterRectangle()

      await cntrRect1point1()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `profile007 = startProfileAt([8.41, -9.29], sketch001)`
      )
      await cntrRect1point2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `|> angledLine(angle = 0, length = 7.06, tag = $rectangleSegmentA003)
  |> angledLine([
       segAng(rectangleSegmentA003) + 90,
       4.34
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA003),
       -segLen(rectangleSegmentA003)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`.replaceAll('\n', '')
      )
      await page.waitForTimeout(300)

      await cntrRect2point1()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `profile008 = startProfileAt([19.33, -5.56], sketch001)`
      )
      await cntrRect2point2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `|> angledLine(angle = 0, length = 3.12, tag = $rectangleSegmentA004)
  |> angledLine([
       segAng(rectangleSegmentA004) + 90,
       6.24
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA004),
       -segLen(rectangleSegmentA004)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`.replaceAll('\n', '')
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
      await editor.expectEditor.toContain(
        `profile009 = circleThreePoint(
  sketch001,
  p1 = [8.82, -14.58],
  p2 = [11.73, -6.1],
  p3 = [11.83, -6],
)`,
        { shouldNormalise: true }
      )

      await circle3Point1p3Move()
      await circle3Point1p3()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `profile009 = circleThreePoint(
  sketch001,
  p1 = [8.82, -14.58],
  p2 = [11.73, -6.1],
  p3 = [15.87, -11.12],
)`,
        { shouldNormalise: true }
      )

      await circle3Point2p1Move()
      await circle3Point2p1()
      await page.waitForTimeout(300)
      await circle3Point2p2Move()
      await circle3Point2p2()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `profile010 = circleThreePoint(
  sketch001,
  p1 = [25.5, -6.85],
  p2 = [25.43, -1.97],
  p3 = [25.53, -1.87],
)`,
        { shouldNormalise: true }
      )

      await circle3Point2p3Move()
      await circle3Point2p3()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        `profile010 = circleThreePoint(
  sketch001,
  p1 = [25.5, -6.85],
  p2 = [25.43, -1.97],
  p3 = [22.65, -3.8],
)`,
        { shouldNormalise: true }
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
        `profile011 = startProfileAt([13.56, -9.97], sketch001)
  |> arcTo({
       interior = [15.19, -6.51],
       end = [19.33, -11.19]
     }, %)`,
        { shouldNormalise: true }
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
        `  |> arcTo({
       interior = [19.8, 1.7],
       end = [21.7, 2.92]
     }, %)
  |> arcTo({
       interior = [27.47, 1.42],
       end = [27.57, 1.52]
     }, %)`,
        { shouldNormalise: true }
      )
    })

    await test.step('double check that three-point arc can be unequipped', async () => {
      // this was tested implicitly for other tools, but not for three-point arc since it's last
      await page.waitForTimeout(300)
      await expect
        .poll(async () => {
          await toolbar.lineBtn.click()
          return toolbar.lineBtn.getAttribute('aria-pressed')
        })
        .toBe('true')
    })
  })

  test(
    'Can edit a sketch with multiple profiles, dragging segments to edit them, and adding one new profile',
    { tag: ['@skipWin'] },
    async ({ homePage, scene, toolbar, editor, page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([6.24, 4.54], sketch001)
  |> line(end = [-0.41, 6.99])
  |> line(end = [8.61, 0.74])
  |> line(end = [10.99, -5.22])
profile002 = startProfileAt([11.19, 5.02], sketch001)
  |> angledLine(angle = 0, length = 10.78, tag = $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       4.14
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile003 = circle(sketch001, center = [6.92, -4.2], radius = 3.16)
profile004 = circleThreePoint(sketch001, p1 = [13.44, -6.8], p2 = [13.39, -2.07], p3 = [18.75, -4.41])
`
        )
      })

      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      // The text to prompt popover gets in the way of pointOnSegment click otherwise
      const moveToClearToolBarPopover = scene.makeMouseHelpers(590, 500)[1]

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

      const [circ3PStart] = scene.makeMouseHelpers(854, 332)
      const [circ3PEnd] = scene.makeMouseHelpers(870, 275)

      await test.step('enter sketch and setup', async () => {
        await moveToClearToolBarPopover()
        await page.waitForTimeout(1000)
        await pointOnSegment({ shouldDbClick: true })
        await page.waitForTimeout(2000)

        await toolbar.lineBtn.click()
        await page.waitForTimeout(100)
      })

      await test.step('extend existing profile', async () => {
        await profileEnd()
        await page.waitForTimeout(100)
        await newProfileEnd()
        await editor.expectEditor.toContain(`|> line(end = [-11.35, 0.73])`)
        await toolbar.lineBtn.click()
        await page.waitForTimeout(100)
      })

      await test.step('edit existing profile', async () => {
        await profileEndMv()
        await page.mouse.down()
        await dragSegmentTo()
        await page.mouse.up()
        await editor.expectEditor.toContain(`line(end = [4.22, -4.49])`)
      })

      await test.step('edit existing rect', async () => {
        await rectHandle()
        await page.mouse.down()
        await rectDragTo()
        await page.mouse.up()
        await editor.expectEditor.toContain(
          `angledLine(angle = -7, length = 10.27, tag = $rectangleSegmentA001)`
        )
      })

      await test.step('edit existing circl', async () => {
        await circleEdge()
        await page.mouse.down()
        await dragCircleTo()
        await page.mouse.up()
        await editor.expectEditor.toContain(
          `profile003 = circle(sketch001, center = [6.92, -4.2], radius = 4.81)`
        )
      })

      await test.step('edit existing circle three point', async () => {
        await circ3PStart()
        await page.mouse.down()
        await circ3PEnd()
        await page.mouse.up()
        await editor.expectEditor.toContain(
          `profile004 = circleThreePoint(
  sketch001,
  p1 = [13.44, -6.8],
  p2 = [13.39, -2.07],
  p3 = [19.73, -1.33],
)`,
          { shouldNormalise: true }
        )
      })

      await test.step('add new profile', async () => {
        await toolbar.rectangleBtn.click()
        await page.waitForTimeout(100)
        await rectStart()
        await editor.expectEditor.toContain(
          `profile005 = startProfileAt([15.68, -3.84], sketch001)`
        )
        await page.waitForTimeout(100)
        await rectEnd()
        await editor.expectEditor.toContain(
          `|> angledLine(angle = 180, length = 1.97, tag = $rectangleSegmentA002)
  |> angledLine([
       segAng(rectangleSegmentA002) + 90,
       3.89
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA002),
       -segLen(rectangleSegmentA002)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`.replaceAll('\n', '')
        )
      })
    }
  )
  test(
    'Can delete a profile in the editor while is sketch mode, and sketch mode does not break, can ctrl+z to undo after constraint with variable was added',
    { tag: ['@skipWin', '@skipLinux'] },
    async ({ scene, toolbar, editor, cmdBar, page, homePage }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([6.24, 4.54], sketch001)
  |> line(end = [-0.41, 6.99])
  |> line(end = [8.61, 0.74])
  |> line(end = [10.99, -5.22])
profile002 = startProfileAt([11.19, 5.02], sketch001)
  |> angledLine(angle = 0, length = 10.78, tag = $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       4.14
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile003 = circle(sketch001, center = [6.92, -4.2], radius = 3.16)
`
        )
      })

      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      // The text to prompt popover gets in the way of pointOnSegment click otherwise
      const moveToClearToolBarPopover = scene.makeMouseHelpers(590, 500)[1]

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
        await moveToClearToolBarPopover()
        await pointOnSegment({ shouldDbClick: true })
        await page.waitForTimeout(600)
      })

      await test.step('select and delete code for a profile', async () => {})
      await page.getByText('close()').click()
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
        // If this timeout isn't long enough, the test breaks.
        // TODO: fix https://github.com/KittyCAD/modeling-app/issues/5437
        await page.waitForTimeout(3_000)
      })

      await sketchIsDrawnProperly()

      await test.step('Adding a constraint with a variable, and than ctrl-z-ing which will remove the variable again does not break sketch mode', async () => {
        await expect(async () => {
          await segment1Click()
          await editor.expectState({
            diagnostics: [],
            activeLines: ['|>line(end = [-0.41,6.99])'],
            highlightedCode: 'line(end = [-0.41,6.99])',
          })
        }).toPass({ timeout: 30_000, intervals: [1500] })

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
    }
  )

  test(
    'can enter sketch when there is an extrude',
    { tag: ['@skipWin'] },
    async ({ homePage, scene, toolbar, page, cmdBar }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([-63.43, 193.08], sketch001)
  |> line(end = [168.52, 149.87])
  |> line(end = [190.29, -39.18])
  |> tangentialArcTo([319.63, 129.65], %)
  |> line(end = [-217.65, -21.76])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile003 = startProfileAt([16.79, 38.24], sketch001)
  |> angledLine(angle = 0, length = 182.82, tag = $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       105.71
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
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
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      const [pointOnSegment] = scene.makeMouseHelpers(574, 207)

      await pointOnSegment()
      await toolbar.editSketch()
      // wait for engine animation
      await page.waitForTimeout(600)

      await test.step('check the sketch is still drawn properly', async () => {
        await Promise.all([
          scene.expectPixelColor(TEST_COLORS.WHITE, { x: 596, y: 165 }, 15),
          scene.expectPixelColor(TEST_COLORS.WHITE, { x: 641, y: 220 }, 15),
          scene.expectPixelColor(TEST_COLORS.WHITE, { x: 763, y: 214 }, 15),
        ])
      })
    }
  )
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

    await page.waitForTimeout(5000)
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)

    await toolbar.startSketchPlaneSelection()
    await selectXZPlane()
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

      await scene.settled(cmdBar)

      await scene.expectPixelColor([255, 255, 255], { x: 633, y: 211 }, 15)
    })
  })
  test(
    'A sketch with only "startProfileAt" and no segments should still be able to be continued',
    { tag: ['@skipWin'] },
    async ({ homePage, scene, toolbar, editor, page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([85.19, 338.59], sketch001)
  |> line(end = [213.3, -94.52])
  |> line(end = [-230.09, -55.34])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(XY)
profile002 = startProfileAt([85.81, 52.55], sketch002)

`
        )
      })

      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      const [startProfileAt] = scene.makeMouseHelpers(606, 184)
      const [nextPoint] = scene.makeMouseHelpers(763, 130)
      await page.getByText('startProfileAt([85.81, 52.55], sketch002)').click()
      await toolbar.editSketch(1)
      // timeout wait for engine animation is unavoidable
      await page.waitForTimeout(600)

      // equip line tool
      await toolbar.lineBtn.click()
      await page.waitForTimeout(100)
      await startProfileAt()
      await page.waitForTimeout(100)
      await nextPoint()
      await editor.expectEditor.toContain(`|> line(end = [126.05, 44.12])`)
    }
  )
  test(
    'old style sketch all in one pipe (with extrude) will break up to allow users to add a new profile to the same sketch',
    { tag: ['@skipWin'] },
    async ({ homePage, scene, toolbar, editor, page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
thePart = startSketchOn(XZ)
  |> startProfileAt([7.53, 10.51], %)
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
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

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
        await editor.expectEditor.toContain(
          `thePart = startSketchOn(XZ)  |> startProfileAt([7.53, 10.51], %)`
        )
      })

      await test.step('equiping the line tool should break up the pipe expression', async () => {
        await toolbar.lineBtn.click()
        await editor.expectEditor.toContain(
          `sketch001 = startSketchOn(XZ)thePart = startProfileAt([7.53, 10.51], sketch001)`
        )
      })

      await test.step('can continue on to add a new profile to this sketch', async () => {
        await profilePoint1()
        await editor.expectEditor.toContain(
          `profile001 = startProfileAt([19.69, -7.05], sketch001)`
        )
        await profilePoint2()
        await editor.expectEditor.toContain(`|> line(end = [18.97, -18.06])`)
      })
    }
  )
  test(
    'Can enter sketch on sketch of wall and cap for segment, solid2d, extrude-wall, extrude-cap selections',
    { tag: ['@skipWin'] },
    async ({ homePage, scene, toolbar, editor, page, cmdBar }) => {
      // TODO this test should include a test for selecting revolve walls and caps

      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([6.71, -3.66], sketch001)
  |> line(end = [2.65, 9.02], tag = $seg02)
  |> line(end = [3.73, -9.36], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 20)
sketch002 = startSketchOn(extrude001, seg01)
profile002 = startProfileAt([0.75, 13.46], sketch002)
  |> line(end = [4.52, 3.79])
  |> line(end = [5.98, -2.81])
profile003 = startProfileAt([3.19, 13.3], sketch002)
  |> angledLine(angle = 0, length = 6.64, tag = $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       2.81
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile004 = startProfileAt([3.15, 9.39], sketch002)
  |> xLine(length = 6.92)
  |> line(end = [-7.41, -2.85])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile005 = circle(sketch002, center = [5.15, 4.34], radius = 1.66)
profile006 = startProfileAt([9.65, 3.82], sketch002)
  |> line(end = [2.38, 5.62])
  |> line(end = [2.13, -5.57])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
revolve001 = revolve(
  profile004,
  angle = 45,
  axis = getNextAdjacentEdge(seg01)
)
extrude002 = extrude(profile006, length = 4)
sketch003 = startSketchOn(-XZ)
profile007 = startProfileAt([4.8, 7.55], sketch003)
  |> line(end = [7.39, 2.58])
  |> line(end = [7.02, -2.85])
profile008 = startProfileAt([5.54, 5.49], sketch003)
  |> line(end = [6.34, 2.64])
  |> line(end = [6.33, -2.96])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile009 = startProfileAt([5.23, 1.95], sketch003)
  |> line(end = [6.8, 2.17])
  |> line(end = [7.34, -2.75])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile010 = circle(
  sketch003,
  center = [7.18, -2.11],
  radius = 2.67
)
profile011 = startProfileAt([5.07, -6.39], sketch003)
  |> angledLine(angle = 0, length = 4.54, tag = $rectangleSegmentA002)
  |> angledLine([
       segAng(rectangleSegmentA002) - 90,
       4.17
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA002),
       -segLen(rectangleSegmentA002)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude003 = extrude(profile011, length = 2.5)
// TODO this breaks the test,
// revolve002 = revolve(profile008, angle = 45, axis = seg02)
`
        )
      })

      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await scene.connectionEstablished()
      await scene.settled(cmdBar)
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      const camPositionForSelectingSketchOnWallProfiles = () =>
        scene.moveCameraTo(
          { x: 834, y: -680, z: 534 },
          { x: -54, y: -476, z: 148 }
        )
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

      const verifyWallProfilesAreDrawn = async () =>
        test.step('verify wall profiles are drawn', async () => {
          await Promise.all([
            // open polygon
            scene.expectPixelColor(TEST_COLORS.WHITE, { x: 599, y: 168 }, 15),
            // closed polygon
            scene.expectPixelColor(TEST_COLORS.WHITE, { x: 656, y: 171 }, 15),
            // revolved profile
            scene.expectPixelColor(TEST_COLORS.WHITE, { x: 655, y: 264 }, 15),
            // extruded profile
            scene.expectPixelColor(TEST_COLORS.WHITE, { x: 808, y: 396 }, 15),
            // circle (When entering via the circle, it's selected and therefore blue)
            scene.expectPixelColor(
              [TEST_COLORS.WHITE, TEST_COLORS.BLUE],
              { x: 742, y: 386 },
              15
            ),
          ])
        })

      await test.step('select wall profiles', async () => {
        for (const { title, selectClick } of wallSelectionOptions) {
          await test.step(title, async () => {
            await camPositionForSelectingSketchOnWallProfiles()
            await selectClick()
            await toolbar.editSketch(1)
            await page.waitForTimeout(600)
            await verifyWallProfilesAreDrawn()
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
    }
  )
  test(
    'Can enter sketch loft edges, base and continue sketch',
    { tag: ['@skipWin'] },
    async ({ homePage, scene, toolbar, editor, page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([34, 42.66], sketch001)
  |> line(end = [102.65, 151.99])
  |> line(end = [76, -138.66])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
plane001 = offsetPlane(XZ, offset = 50)
sketch002 = startSketchOn(plane001)
profile002 = startProfileAt([39.43, 172.21], sketch002)
  |> xLine(length = 183.99)
  |> line(end = [-77.95, -145.93])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

loft([profile001, profile002])
`
        )
      })

      await page.setBodyDimensions({ width: 1000, height: 500 })
      await homePage.goToModelingScene()
      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

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
        `angledLine(angle = 0, length = 113.01, tag = $rectangleSegmentA001)`
      )
    }
  )
  test('Can enter sketch loft edges offsetPlane and continue sketch', async ({
    scene,
    toolbar,
    editor,
    page,
    homePage,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([34, 42.66], sketch001)
  |> line(end = [102.65, 151.99])
  |> line(end = [76, -138.66])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
plane001 = offsetPlane(XZ, offset = 50)
sketch002 = startSketchOn(plane001)
profile002 = startProfileAt([39.43, 172.21], sketch002)
  |> xLine(length = 183.99)
  |> line(end = [-77.95, -145.93])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

loft([profile001, profile002])
`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    const topProfileEdgeClickCoords = { x: 602, y: 185 } as const
    const [topProfileEdgeClick] = scene.makeMouseHelpers(
      topProfileEdgeClickCoords.x,
      topProfileEdgeClickCoords.y
    )
    const [sideProfileEdgeClick] = scene.makeMouseHelpers(788, 188)

    const [rect1Crn1] = scene.makeMouseHelpers(592, 283)
    const [rect1Crn2] = scene.makeMouseHelpers(797, 268)

    await scene.moveCameraTo(
      { x: 8171, y: -7740, z: 1624 },
      { x: 3302, y: -627, z: 2892 }
    )

    await topProfileEdgeClick()
    await page.waitForTimeout(300)
    await toolbar.editSketch()
    await page.waitForTimeout(600)
    await sideProfileEdgeClick()
    await page.waitForTimeout(300)
    await scene.expectPixelColor(TEST_COLORS.BLUE, { x: 788, y: 188 }, 15)

    await toolbar.rectangleBtn.click()
    await page.waitForTimeout(100)
    await rect1Crn1()
    await editor.expectEditor.toContain(
      `profile003 = startProfileAt([47.76, -17.13], plane001)`
    )
    await rect1Crn2()
    await editor.expectEditor.toContain(
      `angledLine(angle = 0, length = 106.42], tag = $rectangleSegmentA001)`
    )
    await page.waitForTimeout(100)
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
    cmdBar,
  }) => {
    // We seed the scene with a single offset plane
    await context.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
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
    await scene.settled(cmdBar)

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
        activeLines: ['sketch001=startSketchOn(XZ)'],
        diagnostics: [],
        highlightedCode: 'arcTo({end = [4, 2], interior = [1, 2]}, %)',
      })
    })

    await test.step('reset the selection', async () => {
      // Move the mouse out of the way
      await page.mouse.move(655, 337)

      await editor.expectState({
        activeLines: ['sketch001=startSketchOn(XZ)'],
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
    cmdBar,
  }) => {
    // We seed the scene with a single offset plane
    await context.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        ` sketch001 = startSketchOn(XZ)
|> startProfileAt([256.85, 14.41], %)
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
})
