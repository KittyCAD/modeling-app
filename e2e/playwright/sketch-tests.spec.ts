import fs from 'node:fs/promises'
import path from 'node:path'
import type { Page } from '@playwright/test'
import { roundOff, uuidv4 } from '@src/lib/utils'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import {
  NUMBER_REGEXP,
  PERSIST_MODELING_CONTEXT,
  TEST_COLORS,
  getMovementUtils,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'

test.describe('Sketch tests', () => {
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
  |> arc(angleStart = 0, angleEnd = 360, radius = screwRadius)

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
  |> arc(angleStart = 0, angleEnd = 180, radius = wireRadius)
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

  test('Can edit segments by dragging their handles', () => {
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
      |> startProfile(at = [4.61, -14.01])
      |> line(end = [12.73, -0.09])
      |> tangentialArc(endAbsolute = [24.95, -5.38])
      |> arc(interiorAbsolute = [20.18, -1.7], endAbsolute = [11.82, -1.16])
      |> arc(angleStart = -89.36, angleEnd = 135.81, radius = 5.92)
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
      |> startProfile(at = [4.61, -14.01])
      |> line(end = [12.73, -0.09])
      |> tangentialArc(endAbsolute = [24.95, -5.38])
      |> arc(interiorAbsolute = [20.18, -1.7], endAbsolute = [11.82, -1.16])
      |> arc(angleStart = -89.36, angleEnd = 135.81, radius = 5.92)
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
        await page.getByText('startProfile(at = [4.61, -14.01])').click()
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

      // drag tangentialArc handle
      const tangentEnd = await u.getBoundingBox('[data-overlay-index="1"]')
      await page.mouse.move(tangentEnd.x, tangentEnd.y - 5)
      await page.mouse.down()
      await page.mouse.move(tangentEnd.x + dragPX, tangentEnd.y - dragPX, step5)
      await page.mouse.up()
      await page.waitForTimeout(100)
      if (openPanes.includes('code')) {
        await expect(page.locator('.cm-content')).not.toHaveText(prevContent)
      }

      // drag arcTo interiorAbsolute handle (three point arc)
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
      await expect(
        page.locator('.cm-content')
      ).toHaveText(`sketch001 = startSketchOn(XZ)
  |> startProfile(at = [6.44, -12.07])
  |> line(end = [14.72, 1.97])
  |> tangentialArc(endAbsolute = [26.92, -3.32])
  |> arc(interiorAbsolute = [18.11, -3.73], endAbsolute = [9.77, -3.19])
  |> arc(angleStart = -58.29, angleEnd = 161.17, radius = 3.75)
  |> close()
`)
    }
    test('code pane open at start-handles', async ({
      page,
      homePage,
      scene,
      toolbar,
      cmdBar,
    }) => {
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
    })

    test('code pane closed at start-handles', async ({
      page,
      homePage,
      scene,
      toolbar,
      cmdBar,
    }) => {
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
    await editor.expectEditor.toContain(`|> yLine(length =`)

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
profile001 = startProfile(sketch001, at = [${roundOff(scale * 77.11)}, ${roundOff(
        scale * 34.8
      )}])
    |> xLine(length = ${roundOff(scale * 154.22)})
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
  // TODO: fix after electron migration is merged
  test('empty-scene default-planes act as expected', async ({
    page,
    homePage,
    scene,
    cmdBar,
    editor,
  }) => {
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
    await scene.settled(cmdBar)

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
    |> startProfile(at = [-10, -10])
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

    // wait for line button to have aria-pressed as proxy for sketch mode
    await expect
      .poll(async () => page.getByTestId('line').getAttribute('aria-pressed'), {
        timeout: 10_000,
      })
      .toBe('true')
    await page.waitForTimeout(200)

    await page.mouse.click(XYPlanePoint.x, XYPlanePoint.y)
    await page.waitForTimeout(200)
    await page.mouse.click(XYPlanePoint.x + 50, XYPlanePoint.y + 50)
    await editor.expectEditor.toContain(
      `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [299.72, 230.82])
  |> line(end = [86.12, -86.13])
  `,
      { shouldNormalise: true }
    )

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [299.72, 230.82])
  |> line(end = [86.12, -86.13])
  `
      )
    })
    await scene.settled(cmdBar)

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
          |> angledLine(angle = 60, lengthY = lugHeadLength)
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
  |> angledLine(angle = 0, length = 181.26, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 21.54)
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
    await editor.expectEditor.toContain(
      `tangentialArc(angle = 187.46deg, radius = 3.97)`,
      { shouldNormalise: true }
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
  test(`test it removes half-finished expressions when changing tools in sketch mode`, async ({
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
        `
yo = 5
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [121.52, 168.25])
  |> line(end = [115.04, 113.61])
  |> line(end = [130.87, -97.79])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile002 = startProfile(sketch001, at = [117.2, 56.08])
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
      await editor.expectEditor.not.toContain('profile003 = circleThreePoint(')
    })

    await test.step('equip three-point-arc tool and click first two points', async () => {
      await page.waitForTimeout(200)
      await toolbar.selectThreePointArc()
      await page.waitForTimeout(200)
      await circle3Point1()
      await page.waitForTimeout(200)
      await circle3Point2()
      await editor.expectEditor.toContain('arc(')
    })

    await test.step('equip line tool and verify three-point-arc code is removed after second click', async () => {
      await toolbar.lineBtn.click()
      await editor.expectEditor.not.toContain('arc(')
    })

    const [cornerRectPoint1] = scene.makeMouseHelpers(600, 300)

    await test.step('equip corner rectangle tool and click first point', async () => {
      await toolbar.rectangleBtn.click()
      await page.waitForTimeout(100)
      await cornerRectPoint1()
      await editor.expectEditor.toContain('profile004 = startProfile(')
    })

    await test.step('equip line tool and verify corner rectangle code is removed', async () => {
      await toolbar.lineBtn.click()
      await editor.expectEditor.not.toContain('profile004 = startProfile(')
    })

    const [centerRectPoint1] = scene.makeMouseHelpers(700, 300)

    await test.step('equip center rectangle tool and click first point', async () => {
      await toolbar.selectCenterRectangle()
      await page.waitForTimeout(100)
      await centerRectPoint1()
      await editor.expectEditor.toContain('profile004 = startProfile(')
    })

    await test.step('equip line tool and verify center rectangle code is removed', async () => {
      await toolbar.lineBtn.click()
      await editor.expectEditor.not.toContain('profile004 = startProfile(')
    })

    await test.step('continue profile002 with the three point arc tool, and then switch back to the line tool to verify it only removes the last expression in the pipe', async () => {
      await toolbar.selectThreePointArc()
      await page.waitForTimeout(200)
      await continueProfile2Clk()
      await page.waitForTimeout(200)
      await circle3Point1()
      await editor.expectEditor.toContain('arc(')
      await toolbar.lineBtn.click()
      await editor.expectEditor.not.toContain('arc(')
      await editor.expectEditor.toContain('profile002')
    })
  })
  test(`snapToProfile start only works for current profile`, async ({
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
        `@settings(defaultLengthUnit = in)

sketch001 = startSketchOn(XZ)
profile002 = startProfile(sketch001, at = [40.68, 87.67])
  |> xLine(length = 239.17)
profile003 = startProfile(sketch001, at = [206.63, -56.73])
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

    const codeFromTangentialArc = `  |> tangentialArc(end = [-10.82, 144.95])`
    await test.step('check that tangential tool does not snap to other profile starts', async () => {
      await toolbar.selectTangentialArc()
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
        `
tangentialArc(end = [-10.82, 144.95])`
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
  })
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
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await editor.closePane()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    const [selectXZPlane] = scene.makeMouseHelpers(650, 150)

    const [startProfile1] = scene.makeMouseHelpers(568, 150)
    const [endLineStartTanArc] = scene.makeMouseHelpers(701, 158)
    const [endArcStartLine] = scene.makeMouseHelpers(745, 189)

    const [startProfile2] = scene.makeMouseHelpers(782, 120)
    const [profile2Point2] = scene.makeMouseHelpers(921, 130)
    const [profile2Point3] = scene.makeMouseHelpers(953, 178)

    const [circle1Center] = scene.makeMouseHelpers(842, 147)
    const [circle1Radius, circle1RadiusMove] = scene.makeMouseHelpers(870, 171)

    const [circle2Center, moveCircle2Center] = scene.makeMouseHelpers(850, 222)
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
      await editor.expectEditor.toContain(/profile001 = startProfile.*\|> line/)
      await toolbar.selectTangentialArc()
      await page.waitForTimeout(300)
      // Purposefully click in a bad spot to see the tan arc warning
      await page.mouse.click(745, 359)
      await page.waitForTimeout(300)
      await endLineStartTanArc({ delay: 544 })

      await endArcStartLine()
      await editor.expectEditor.toContain(
        /profile001 = startProfile.*\|> line.*\|> tangentialArc/
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
      await editor.expectEditor.toContain('')

      // Switch back to line tool to continue
      await toolbar.lineBtn.click()
      await page.waitForTimeout(300)

      // Continue with the original line segment
      await threePointEnd()
      await page.waitForTimeout(300)

      const [lineSegmentClick] = scene.makeMouseHelpers(572, 110)
      await lineSegmentClick()

      await editor.expectEditor.toContain(/arc\(.*\|> line\(/)
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
      await editor.expectEditor.toContain(/profile002 = startProfile.*\|> line/)
      await profile2Point3()
      await page.waitForTimeout(300)
      await editor.expectEditor.toContain(
        /profile002 = startProfile.*\|> line.*\|> line/
      )
    })

    await test.step('create two circles in a row without unequip', async () => {
      await toolbar.circleBtn.click()

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

      await crnRect1point1()
      await editor.expectEditor.toContain(
        /profile005 = startProfile\(sketch001/
      )
      await editor.closePane()
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
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [6.24, 4.54])
  |> line(end = [-0.41, 6.99])
  |> line(end = [8.61, 0.74])
  |> line(end = [10.99, -5.22])
profile002 = startProfile(sketch001, at = [11.19, 5.02])
  |> angledLine(angle = 0, length = 10.78, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 4.14)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
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
      await page.waitForTimeout(200)
      await editor.expectEditor.toContain(
        `angledLine(angle = -7, length = 10.27, tag = $rectangleSegmentA001)`
      )
    })

    await test.step('edit existing circle', async () => {
      await circleEdge()
      await page.mouse.down()
      await dragCircleTo()
      await page.mouse.up()
      await page.waitForTimeout(200)
      await editor.expectEditor.toContain(
        `profile003 = circle(sketch001, center = [6.92, -4.2], radius = 4.81)`
      )
    })

    await test.step('edit existing circle three point', async () => {
      await circ3PStart()
      await page.mouse.down()
      await circ3PEnd()
      await page.mouse.up()
      await page.waitForTimeout(200)
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
      await page.waitForTimeout(200)
      await rectStart()
      await editor.expectEditor.toContain(
        `profile005 = startProfile(sketch001, at = [15.68, -3.84])`
      )
      await page.waitForTimeout(100)
      await rectEnd()
      await editor.expectEditor.toContain(
        `|> angledLine(angle = 180, length = 1.97, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) + 90, length = 3.89)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()`.replaceAll('\n', '')
      )
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
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [6.24, 4.54])
  |> line(end = [-0.41, 6.99])
  |> line(end = [8.61, 0.74])
  |> line(end = [10.99, -5.22])
profile002 = startProfile(sketch001, at = [11.19, 5.02])
  |> angledLine(angle = 0, length = 10.78, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 4.14)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
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
      // Undo should work with the pane closed
      await editor.closePane()

      await test.step('Undo should work with the pane closed', async () => {
        await editor.closePane()

        // wait for execute defer
        await page.waitForTimeout(600)
        await sketchIsDrawnProperly()

        await page.keyboard.down('Meta')
        await page.keyboard.press('KeyZ')
        await page.keyboard.up('Meta')

        await editor.expectEditor.not.toContain('length001 = 7')
      })

      await sketchIsDrawnProperly()
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
  |> angledLine(angle = 0, length = 182.82, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 105.71)
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

      await editor.closePane()
      await scene.settled(cmdBar)

      await scene.expectPixelColor([255, 255, 255], { x: 633, y: 211 }, 15)
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
  |> angledLine(angle = 0, length = 6.64, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90, length = 2.81)
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
  angle = 45,
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
  |> angledLine(angle = 0, length = 4.54, tag = $rectangleSegmentA002)
  |> angledLine(angle = segAng(rectangleSegmentA002) - 90, length = 4.17)
  |> angledLine(angle = segAng(rectangleSegmentA002), length = -segLen(rectangleSegmentA002))
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
    await toolbar.closePane('code')
    await scene.settled(cmdBar)

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
          await page.waitForTimeout(600)
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

    await page.setBodyDimensions({ width: 1000, height: 500 })
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
        `sketch001 = startSketchOn(XZ)
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
      `profile003 = startProfile(plane001, at = [47.76, -17.13])`
    )
    await rect1Crn2()
    await editor.expectEditor.toContain(
      `angledLine(angle = 0, length = 106.42
], tag = $rectangleSegmentA001)`
    )
    await page.waitForTimeout(100)
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
  test('Can edit sketch through feature tree with variable modifications', async ({
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
      |> angledLine(angle = 0, length = 119.61, tag = $rectangleSegmentA001)
      |> angledLine(length = 156.54, angle = -28)
      |> angledLine(
          angle = -151,
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
      await toolbar.openFeatureTreePane()
      const sketchButton = await toolbar.getFeatureTreeOperation('Sketch', 1)
      await sketchButton.dblclick()
      await page.waitForTimeout(700) // Wait for engine animation
    })

    await test.step('Add new variable and wait for re-execution', async () => {
      await page.waitForTimeout(500) // wait for deferred execution
      await editor.replaceCode('myVar2 = 6', 'myVar2 = 6\nmyVar3 = 7')
      await page.waitForTimeout(2000) // wait for deferred execution
    })

    const handle1Location = { x: 843, y: 235 }
    await test.step('Edit sketch by dragging handle', async () => {
      await page.waitForTimeout(500)
      await expect
        .poll(
          async () => {
            await editor.expectEditor.toContain('length = 156.54, angle = -28')
            await page.mouse.move(handle1Location.x, handle1Location.y)
            await page.mouse.down()
            await page.mouse.move(
              handle1Location.x + 50,
              handle1Location.y + 50,
              {
                steps: 5,
              }
            )
            await page.mouse.up()
            await editor.expectEditor.toContain('length = 231.59, angle = -34')
            return true
          },
          { timeout: 10_000 }
        )
        .toBeTruthy()
    })

    await test.step('Delete variables and wait for re-execution', async () => {
      await page.waitForTimeout(500)
      await editor.replaceCode('myVar3 = 7', '')
      await page.waitForTimeout(50)
      await editor.replaceCode('myVar2 = 6', '')
      await page.waitForTimeout(2000) // Wait for deferred execution
    })

    const handle2Location = { x: 872, y: 273 }
    await test.step('Edit sketch again', async () => {
      await editor.expectEditor.toContain('length = 231.59, angle = -34')
      await page.waitForTimeout(500)
      await expect
        .poll(
          async () => {
            await page.mouse.move(handle2Location.x, handle2Location.y)
            await page.mouse.down()
            await page.mouse.move(handle2Location.x, handle2Location.y - 50, {
              steps: 5,
            })
            await page.mouse.up()
            await editor.expectEditor.toContain('length = 167.36, angle = -14')
            return true
          },
          { timeout: 10_000 }
        )
        .toBeTruthy()
    })

    await test.step('add whole other sketch before current sketch', async () => {
      await page.waitForTimeout(500)
      await editor.replaceCode(
        `myVar1 = 5`,
        `myVar1 = 5
    sketch003 = startSketchOn(XY)
    profile004 = circle(sketch003, center = [143.91, 136.89], radius = 71.63)`
      )
      await page.waitForTimeout(2000) // Wait for deferred execution
    })

    const handle3Location = { x: 844, y: 212 }
    await test.step('edit sketch again', async () => {
      await page.waitForTimeout(500) // Wait for deferred execution
      await expect
        .poll(
          async () => {
            await editor.expectEditor.toContain('length = 167.36, angle = -14')
            await page.mouse.move(handle3Location.x, handle3Location.y)
            await page.mouse.down()
            await page.mouse.move(handle3Location.x, handle3Location.y + 110, {
              steps: 5,
            })
            await page.mouse.up()
            await editor.expectEditor.toContain('length = 219.2, angle = -56')
            return true
          },
          { timeout: 10_000 }
        )
        .toBeTruthy()
    })

    // exit sketch and assert whole code
    await test.step('Exit sketch and assert code', async () => {
      await toolbar.exitSketch()
      await editor.expectEditor.toContain(
        `myVar1 = 5
sketch003 = startSketchOn(XY)
profile004 = circle(sketch003, center = [143.91, 136.89], radius = 71.63)

sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [106.68, 89.77])
  |> line(end = [132.34, 157.8])
  |> line(end = [67.65, -460.55], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 500)
sketch002 = startSketchOn(extrude001, face = seg01)
profile002 = startProfile(sketch002, at = [83.39, 329.15])
  |> angledLine(angle = 0, length = 119.61, tag = $rectangleSegmentA001)
  |> angledLine(length = 219.2, angle = -56)
  |> angledLine(angle = -151, length = 116.27)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile003 = startProfile(sketch002, at = [-201.08, 254.17])
  |> line(end = [103.55, 33.32])
  |> line(end = [48.8, -153.54])
`,
        { shouldNormalise: true }
      )
      await editor.expectState({
        activeLines: [],
        diagnostics: [],
        highlightedCode: '',
      })
    })
  })
  test('Will exit out of sketch mode for some incompatible edits', async ({
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
      |> angledLine(angle = 0, length = 119.61, tag = $rectangleSegmentA001)
      |> angledLine(length = 156.54, angle = -28)
      |> angledLine(
           angle = -151,
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
    const expectSketchOriginToBeDrawn = async () => {
      await scene.expectPixelColor(TEST_COLORS.WHITE, { x: 672, y: 193 }, 15)
    }

    await test.step('Open feature tree and edit second sketch', async () => {
      await toolbar.openFeatureTreePane()
      const sketchButton = await toolbar.getFeatureTreeOperation('Sketch', 1)
      await sketchButton.dblclick()
      await page.waitForTimeout(700) // Wait for engine animation
      await expectSketchOriginToBeDrawn()
    })

    await test.step('rename variable of current sketch, sketch002 to changeSketchNamePartWayThrough', async () => {
      await editor.replaceCode('sketch002', 'changeSketchNamePartWayThrough')
      await page.waitForTimeout(100)
      // three times to rename the declaration and it's use
      await editor.replaceCode('sketch002', 'changeSketchNamePartWayThrough')
      await page.waitForTimeout(100)
      await editor.replaceCode('sketch002', 'changeSketchNamePartWayThrough')
      await expect(
        page.getByText('Unable to maintain sketch mode')
      ).toBeVisible()
    })
  })
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
      |> angledLine(angle = 0, length = 119.61, tag = $rectangleSegmentA001)
      |> angledLine(length = 156.54, angle = -28)
      |> angledLine(
           angle = -151,
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

  test('adding a syntax error, recovers after fixing', async ({
    page,
    homePage,
    context,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
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

    // wait for scene to load
    await scene.settled(cmdBar)

    await test.step('check chamfer selection changes cursor position', async () => {
      await expect(async () => {
        // sometimes initial click doesn't register
        await objClick()
        await editor.expectActiveLinesToBe([
          '|> startProfile(at = [75.8, 317.2]) // [$startCapTag, $EndCapTag]',
        ])
      }).toPass({ timeout: 15_000, intervals: [500] })
    })

    await test.step('enter sketch and sanity check segments have been drawn', async () => {
      await toolbar.editSketch()
      // this checks sketch segments have been drawn
      await verifyArrowHeadColor(arrowHeadWhite)
    })

    await test.step('Make typo and check the segments have Disappeared and there is a syntax error', async () => {
      await editor.replaceCode(
        'line(endAbsolute = [pro',
        'badBadBadFn(endAbsolute = [pro'
      )
      await editor.expectState({
        activeLines: [],
        diagnostics: ['`badBadBadFn`isnotdefined'],
        highlightedCode: '',
      })
      await expect(
        page.getByText(
          "Error in kcl script, sketch cannot be drawn until it's fixed"
        )
      ).toBeVisible()
      // this checks sketch segments have failed to be drawn
      await verifyArrowHeadColor(backgroundGray)
    })

    await test.step('', async () => {
      await editor.replaceCode(
        'badBadBadFn(endAbsolute = [pro',
        'line(endAbsolute = [pro'
      )
      await editor.expectState({
        activeLines: [],
        diagnostics: [],
        highlightedCode: '',
      })
      // this checks sketch segments have been drawn
      await verifyArrowHeadColor(arrowHeadWhite)
    })

    await test.step('make a change to the code and expect pixel color to change', async () => {
      // defends against a regression where sketch would duplicate in the scene
      // https://github.com/KittyCAD/modeling-app/issues/6345
      await editor.replaceCode(
        'startProfile(at = [75.8, 317.2',
        'startProfile(at = [75.8, 217.2'
      )
      // expect not white anymore
      await scene.expectPixelColorNotToBe(
        TEST_COLORS.WHITE,
        arrowHeadLocation,
        15
      )
    })
  })
})
