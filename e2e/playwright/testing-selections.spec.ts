import { test, expect } from '@playwright/test'

import { commonPoints, getUtils, setup, tearDown } from './test-utils'
import { Coords2d } from 'lang/std/sketch'
import { KCL_DEFAULT_LENGTH } from 'lib/constants'
import { uuidv4 } from 'lib/utils'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Testing selections', () => {
  test.setTimeout(90_000)
  test('Selections work on fresh and edited sketch', async ({ page }) => {
    // Skip on windows its being weird.
    test.skip(process.platform === 'win32', 'Skip on windows')

    // tests mapping works on fresh sketch and edited sketch
    // tests using hovers which is the same as selections, because if
    // source ranges are wrong, hovers won't work
    const u = await getUtils(page)
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

    const xAxisClick = () =>
      page.mouse.click(700, 253).then(() => page.waitForTimeout(100))
    const xAxisClickAfterExitingSketch = () =>
      page.mouse.click(639, 278).then(() => page.waitForTimeout(100))
    const emptySpaceHover = () =>
      test.step('Hover over empty space', async () => {
        await page.mouse.move(700, 143, { steps: 5 })
        await expect(page.locator('.hover-highlight')).not.toBeVisible()
      })
    const emptySpaceClick = () =>
      test.step(`Click in empty space`, async () => {
        await page.mouse.click(700, 143)
        await expect(page.locator('.cm-line').last()).toHaveClass(
          /cm-activeLine/
        )
      })
    const topHorzSegmentClick = () =>
      page.mouse
        .click(startXPx, 500 - PUR * 20)
        .then(() => page.waitForTimeout(100))
    const bottomHorzSegmentClick = () =>
      page.mouse
        .click(startXPx + PUR * 10, 500 - PUR * 10)
        .then(() => page.waitForTimeout(100))

    await u.clearCommandLogs()
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await page.getByRole('button', { name: 'Start Sketch' }).click()

    // select a plane
    await page.mouse.click(700, 200)
    await page.waitForTimeout(700) // wait for animation

    const startXPx = 600
    await u.closeDebugPanel()
    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)`)

    await page.waitForTimeout(100)
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)`)

    await page.waitForTimeout(100)
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)
    |> line([0, ${commonPoints.num1 + 0.01}], %)`)
    await page.waitForTimeout(100)
    await page.mouse.click(startXPx, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`const sketch001 = startSketchOn('XZ')
    |> startProfileAt(${commonPoints.startAt}, %)
    |> line([${commonPoints.num1}, 0], %)
    |> line([0, ${commonPoints.num1 + 0.01}], %)
    |> line([-${commonPoints.num2}, 0], %)`)

    // deselect line tool
    await page.getByRole('button', { name: 'line Line', exact: true }).click()

    await u.closeDebugPanel()
    const selectionSequence = async () => {
      await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

      await page.waitForTimeout(100)
      await page.mouse.move(startXPx + PUR * 15, 500 - PUR * 10)

      await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
      // bg-yellow-300/70 is more brittle than hover-highlight, but is closer to the user experience
      // and will be an easy fix if it breaks because we change the colour
      await expect(page.locator('.bg-yellow-300\\/70')).toBeVisible()
      // check mousing off, than mousing onto another line
      await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 15) // mouse off
      await expect(page.getByTestId('hover-highlight')).not.toBeVisible()
      await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 20) // mouse onto another line
      await expect(page.getByTestId('hover-highlight').first()).toBeVisible()

      // now check clicking works including axis

      // click a segment hold shift and click an axis, see that a relevant constraint is enabled
      await topHorzSegmentClick()
      await page.keyboard.down('Shift')
      const constrainButton = page.getByRole('button', {
        name: 'Length: open menu',
      })
      const absYButton = page.getByRole('button', { name: 'Absolute Y' })
      await constrainButton.click()
      await expect(absYButton).toBeDisabled()
      await page.waitForTimeout(100)
      await xAxisClick()
      await page.keyboard.up('Shift')
      await constrainButton.click()
      await absYButton.and(page.locator(':not([disabled])')).waitFor()
      await expect(absYButton).not.toBeDisabled()

      // clear selection by clicking on nothing
      await emptySpaceClick()

      await page.waitForTimeout(100)
      // same selection but click the axis first
      await xAxisClick()
      await constrainButton.click()
      await expect(absYButton).toBeDisabled()
      await page.keyboard.down('Shift')
      await page.waitForTimeout(100)
      await topHorzSegmentClick()
      await page.waitForTimeout(100)

      await page.keyboard.up('Shift')
      await constrainButton.click()
      await expect(absYButton).not.toBeDisabled()

      // clear selection by clicking on nothing
      await emptySpaceClick()

      // check the same selection again by putting cursor in code first then selecting axis
      await page.getByText(`  |> line([-${commonPoints.num2}, 0], %)`).click()
      await page.keyboard.down('Shift')
      await constrainButton.click()
      await expect(absYButton).toBeDisabled()
      await page.waitForTimeout(100)
      await xAxisClick()
      await page.keyboard.up('Shift')
      await constrainButton.click()
      await expect(absYButton).not.toBeDisabled()

      // clear selection by clicking on nothing
      await emptySpaceClick()

      // select segment in editor than another segment in scene and check there are two cursors
      // TODO change this back to shift click in the scene, not cmd click in the editor
      await bottomHorzSegmentClick()

      await expect(page.locator('.cm-cursor')).toHaveCount(1)

      await page.keyboard.down(
        process.platform === 'linux' ? 'Control' : 'Meta'
      )
      await page.waitForTimeout(100)
      await page.getByText(`  |> line([-${commonPoints.num2}, 0], %)`).click()

      await expect(page.locator('.cm-cursor')).toHaveCount(2)
      await page.waitForTimeout(500)
      await page.keyboard.up(process.platform === 'linux' ? 'Control' : 'Meta')

      // clear selection by clicking on nothing
      await emptySpaceClick()
    }

    await test.step(`Test hovering and selecting on fresh sketch`, async () => {
      await selectionSequence()
    })

    // hovering in fresh sketch worked, lets try exiting and re-entering
    await u.openAndClearDebugPanel()
    await page.getByRole('button', { name: 'Exit Sketch' }).click()
    await page.waitForTimeout(200)
    // wait for execution done

    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // select a line, this verifies that sketches in the scene can be selected outside of sketch mode
    await topHorzSegmentClick()
    await xAxisClickAfterExitingSketch()
    await page.waitForTimeout(100)
    await emptySpaceHover()

    // enter sketch again
    await u.doAndWaitForCmd(
      () => page.getByRole('button', { name: 'Edit Sketch' }).click(),
      'default_camera_get_settings'
    )

    await page.waitForTimeout(450) // wait for animation

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        center: { x: 0, y: 0, z: 0 },
        vantage: { x: 0, y: -1378.01, z: 0 },
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

    await emptySpaceClick()

    await u.closeDebugPanel()

    await test.step(`Test hovering and selecting on edited sketch`, async () => {
      await selectionSequence()
    })
  })

  test('Solids should be select and deletable', async ({ page }) => {
    test.setTimeout(90_000)
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
        |> startProfileAt([-79.26, 95.04], %)
        |> line([112.54, 127.64], %, $seg02)
        |> line([170.36, -121.61], %, $seg01)
        |> lineTo([profileStartX(%), profileStartY(%)], %)
        |> close(%)
const extrude001 = extrude(50, sketch001)
const sketch005 = startSketchOn(extrude001, 'END')
  |> startProfileAt([23.24, 136.52], %)
  |> line([-8.44, 36.61], %)
  |> line([49.4, 2.05], %)
  |> line([29.69, -46.95], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch003 = startSketchOn(extrude001, seg01)
  |> startProfileAt([21.23, 17.81], %)
  |> line([51.97, 21.32], %)
  |> line([4.07, -22.75], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const sketch002 = startSketchOn(extrude001, seg02)
  |> startProfileAt([-100.54, 16.99], %)
  |> line([0, 20.03], %)
  |> line([62.61, 0], %, $seg03)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude002 = extrude(50, sketch002)
const sketch004 = startSketchOn(extrude002, seg03)
  |> startProfileAt([57.07, 134.77], %)
  |> line([-4.72, 22.84], %)
  |> line([28.8, 6.71], %)
  |> line([9.19, -25.33], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude003 = extrude(20, sketch004)
const pipeLength = 40
const pipeSmallDia = 10
const pipeLargeDia = 20
const thickness = 0.5
const part009 = startSketchOn('XY')
  |> startProfileAt([pipeLargeDia - (thickness / 2), 38], %)
  |> line([thickness, 0], %)
  |> line([0, -1], %)
  |> angledLineToX({
       angle: 60,
       to: pipeSmallDia + thickness
     }, %)
  |> line([0, -pipeLength], %)
  |> angledLineToX({
       angle: -60,
       to: pipeLargeDia + thickness
     }, %)
  |> line([0, -1], %)
  |> line([-thickness, 0], %)
  |> line([0, 1], %)
  |> angledLineToX({ angle: 120, to: pipeSmallDia }, %)
  |> line([0, pipeLength], %)
  |> angledLineToX({ angle: 60, to: pipeLargeDia }, %)
  |> close(%)
const rev = revolve({ axis: 'y' }, part009)
`
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setViewportSize({ width: 1000, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 1139.49, y: -7053, z: 8597.31 },
        center: { x: -2206.68, y: -1298.36, z: 60 },
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

    const revolve = { x: 646, y: 248 }
    const parentExtrude = { x: 915, y: 133 }
    const solid2d = { x: 770, y: 167 }

    // DELETE REVOLVE
    await page.mouse.click(revolve.x, revolve.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line([0, -pipeLength], %)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)

    await expect(u.codeLocator).not.toContainText(
      `const rev = revolve({ axis: 'y' }, part009)`
    )

    // DELETE PARENT EXTRUDE
    await page.mouse.click(parentExtrude.x, parentExtrude.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line([170.36, -121.61], %, $seg01)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)
    await expect(u.codeLocator).not.toContainText(
      `const extrude001 = extrude(50, sketch001)`
    )
    await expect(u.codeLocator).toContainText(`const sketch005 = startSketchOn({
       plane: {
         origin: { x: 0, y: -50, z: 0 },
         x_axis: { x: 1, y: 0, z: 0 },
         y_axis: { x: 0, y: 0, z: 1 },
         z_axis: { x: 0, y: -1, z: 0 }
       }
     })`)
    await expect(u.codeLocator).toContainText(`const sketch003 = startSketchOn({
       plane: {
         origin: { x: 116.53, y: 0, z: 163.25 },
         x_axis: { x: -0.81, y: 0, z: 0.58 },
         y_axis: { x: 0, y: -1, z: 0 },
         z_axis: { x: 0.58, y: 0, z: 0.81 }
       }
     })`)
    await expect(u.codeLocator).toContainText(`const sketch002 = startSketchOn({
       plane: {
         origin: { x: -91.74, y: 0, z: 80.89 },
         x_axis: { x: -0.66, y: 0, z: -0.75 },
         y_axis: { x: 0, y: -1, z: 0 },
         z_axis: { x: -0.75, y: 0, z: 0.66 }
       }
     })`)

    // DELETE SOLID 2D
    await page.mouse.click(solid2d.x, solid2d.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> startProfileAt([23.24, 136.52], %)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)
    await expect(u.codeLocator).not.toContainText(
      `const sketch005 = startSketchOn({`
    )
  })
  test("Deleting solid that the AST mod can't handle results in a toast message", async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-79.26, 95.04], %)
  |> line([112.54, 127.64], %, $seg02)
  |> line([170.36, -121.61], %, $seg01)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
const launderExtrudeThroughVar = extrude001
const sketch002 = startSketchOn(launderExtrudeThroughVar, seg02)
  |> startProfileAt([-100.54, 16.99], %)
  |> line([0, 20.03], %)
  |> line([62.61, 0], %, $seg03)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
`
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setViewportSize({ width: 1000, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await u.closeDebugPanel()

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 1139.49, y: -7053, z: 8597.31 },
        center: { x: -2206.68, y: -1298.36, z: 60 },
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

    // attempt delete
    await page.mouse.click(930, 139)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line([170.36, -121.61], %, $seg01)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Backspace')

    await expect(page.getByText('Unable to delete part')).toBeVisible()
  })
  test('Hovering over 3d features highlights code, clicking puts the cursor in the right place and sends selection id to engine', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async (KCL_DEFAULT_LENGTH) => {
      localStorage.setItem(
        'persistCode',
        `const part001 = startSketchOn('XZ')
    |> startProfileAt([20, 0], %)
    |> line([7.13, 4 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 3.14 + 0 }, %)
    |> lineTo([20.14 + 0, -0.14 + 0], %)
    |> xLineTo(29 + 0, %)
    |> yLine(-3.14 + 0, %, $a)
    |> xLine(1.63, %)
    |> angledLineOfXLength({ angle: 3 + 0, length: 3.14 }, %)
    |> angledLineOfYLength({ angle: 30, length: 3 + 0 }, %)
    |> angledLineToX({ angle: 22.14 + 0, to: 12 }, %)
    |> angledLineToY({ angle: 30, to: 11.14 }, %)
    |> angledLineThatIntersects({
          angle: 3.14,
          intersectTag: a,
          offset: 0
        }, %)
    |> tangentialArcTo([13.14 + 0, 13.14], %)
    |> close(%)
    |> extrude(5 + 7, %)
  `
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

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

    const extrusionTopCap: Coords2d = [800, 240]
    const flatExtrusionFace: Coords2d = [960, 160]
    const tangentialArcTo: Coords2d = [840, 160]
    const close: Coords2d = [720, 200]
    const nothing: Coords2d = [600, 200]
    const closeEdge: Coords2d = [744, 233]
    const closeAdjacentEdge: Coords2d = [743, 277]
    const closeOppositeEdge: Coords2d = [687, 169]

    const tangentialArcEdge: Coords2d = [811, 142]
    const tangentialArcOppositeEdge: Coords2d = [820, 180]
    const tangentialArcAdjacentEdge: Coords2d = [688, 123]

    const straightSegmentEdge: Coords2d = [819, 369]
    const straightSegmentOppositeEdge: Coords2d = [822, 368]
    const straightSegmentAdjacentEdge: Coords2d = [893, 165]

    await page.mouse.move(nothing[0], nothing[1])
    await page.mouse.click(nothing[0], nothing[1])

    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()
    await page.waitForTimeout(200)

    const checkCodeAtHoverPosition = async (
      name = '',
      coord: Coords2d,
      highlightCode: string,
      activeLine = highlightCode
    ) => {
      await test.step(`test selection for: ${name}`, async () => {
        const highlightedLocator = page.getByTestId('hover-highlight')
        const activeLineLocator = page.locator('.cm-activeLine')

        await test.step(`hover should highlight correct code, clicking should put the cursor in the right place, and send selection to engine`, async () => {
          await expect(async () => {
            await page.mouse.move(nothing[0], nothing[1])
            await page.mouse.move(coord[0], coord[1])
            await expect(highlightedLocator.first()).toBeVisible()
            await expect
              .poll(async () => {
                let textContents = await highlightedLocator.allTextContents()
                const textContentsStr = textContents
                  .join('')
                  .replace(/\s+/g, '')
                console.log(textContentsStr)
                return textContentsStr
              })
              .toBe(highlightCode)
            await page.mouse.move(nothing[0], nothing[1])
          }).toPass({ timeout: 40_000, intervals: [500] })
        })
        await test.step(`click should put the cursor in the right place`, async () => {
          // await page.mouse.move(nothing[0], nothing[1], { steps: 5 })
          // await expect(highlightedLocator.first()).not.toBeVisible()
          await page.mouse.click(coord[0], coord[1])
          await expect
            .poll(async () => {
              const activeLines = await activeLineLocator.allInnerTexts()
              return activeLines.join('')
            })
            .toContain(activeLine)
          // check pixels near the click location are yellow
        })
        await test.step(`check the engine agrees with selections`, async () => {
          // ultimately the only way we know if the engine agrees with the selection from the FE
          // perspective is if it highlights the pixels near where we clicked yellow.
          await expect
            .poll(async () => {
              const RGBs = await u.getPixelRGBs({ x: coord[0], y: coord[1] }, 3)
              for (const rgb of RGBs) {
                const [r, g, b] = rgb
                const RGAverage = (r + g) / 2
                const isRedGreenSameIsh = Math.abs(r - g) < 3
                const isBlueLessThanRG = RGAverage - b > 45
                const isYellowy = isRedGreenSameIsh && isBlueLessThanRG
                if (isYellowy) return true
              }
              return false
            })
            .toBeTruthy()
          await page.mouse.click(nothing[0], nothing[1])
        })
      })
    }

    await checkCodeAtHoverPosition(
      'extrusionTopCap',
      extrusionTopCap,
      'startProfileAt([20,0],%)',
      'startProfileAt([20, 0], %)'
    )
    await checkCodeAtHoverPosition(
      'flatExtrusionFace',
      flatExtrusionFace,
      `angledLineThatIntersects({angle:3.14,intersectTag:a,offset:0},%)extrude(5+7,%)`,
      '}, %)'
    )

    await checkCodeAtHoverPosition(
      'tangentialArcTo',
      tangentialArcTo,
      'tangentialArcTo([13.14+0,13.14],%)extrude(5+7,%)',
      'tangentialArcTo([13.14 + 0, 13.14], %)'
    )
    await checkCodeAtHoverPosition(
      'tangentialArcEdge',
      tangentialArcEdge,
      `tangentialArcTo([13.14+0,13.14],%)`,
      'tangentialArcTo([13.14 + 0, 13.14], %)'
    )
    await checkCodeAtHoverPosition(
      'tangentialArcOppositeEdge',
      tangentialArcOppositeEdge,
      `tangentialArcTo([13.14+0,13.14],%)`,
      'tangentialArcTo([13.14 + 0, 13.14], %)'
    )
    await checkCodeAtHoverPosition(
      'tangentialArcAdjacentEdge',
      tangentialArcAdjacentEdge,
      `tangentialArcTo([13.14+0,13.14],%)`,
      'tangentialArcTo([13.14 + 0, 13.14], %)'
    )

    await checkCodeAtHoverPosition(
      'close',
      close,
      'close(%)extrude(5+7,%)',
      'close(%)'
    )
    await checkCodeAtHoverPosition(
      'closeEdge',
      closeEdge,
      `close(%)`,
      'close(%)'
    )
    await checkCodeAtHoverPosition(
      'closeAdjacentEdge',
      closeAdjacentEdge,
      `close(%)`,
      'close(%)'
    )
    await checkCodeAtHoverPosition(
      'closeOppositeEdge',
      closeOppositeEdge,
      `close(%)`,
      'close(%)'
    )

    await checkCodeAtHoverPosition(
      'straightSegmentEdge',
      straightSegmentEdge,
      `angledLineToY({angle:30,to:11.14},%)`,
      'angledLineToY({ angle: 30, to: 11.14 }, %)'
    )
    await checkCodeAtHoverPosition(
      'straightSegmentOppositeEdge',
      straightSegmentOppositeEdge,
      `angledLineToY({angle:30,to:11.14},%)`,
      'angledLineToY({ angle: 30, to: 11.14 }, %)'
    )
    await checkCodeAtHoverPosition(
      'straightSegmentAdjacentEdge',
      straightSegmentAdjacentEdge,
      `angledLineThatIntersects({angle:3.14,intersectTag:a,offset:0},%)`,
      '}, %)'
    )

    await page.waitForTimeout(200)

    await u.removeCurrentCode()
    await u.codeLocator.fill(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt([75.8, 317.2], %) // [$startCapTag, $EndCapTag]
  |> angledLine([0, 268.43], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       217.26
     ], %, $seg01)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %, $yo)
  |> lineTo([profileStartX(%), profileStartY(%)], %, $seg02)
  |> close(%)
const extrude001 = extrude(100, sketch001)
  |> chamfer({
       length: 30,
       tags: [
         seg01,
         getNextAdjacentEdge(yo),
         getNextAdjacentEdge(seg02),
         getOppositeEdge(seg01)
       ]
     }, %)
`)
    await expect(
      page.getByTestId('model-state-indicator-execution-done')
    ).toBeVisible()

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 16118, y: -1654, z: 5855 },
        center: { x: 4915, y: -3893, z: 4874 },
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

    await page.mouse.click(nothing[0], nothing[1])

    const oppositeChamfer: Coords2d = [577, 230]
    const baseChamfer: Coords2d = [726, 258]
    const adjacentChamfer1: Coords2d = [653, 99]
    const adjacentChamfer2: Coords2d = [653, 430]

    await checkCodeAtHoverPosition(
      'oppositeChamfer',
      oppositeChamfer,
      `angledLine([segAng(rectangleSegmentA001)-90,217.26],%,$seg01)chamfer({length:30,tags:[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)]},%)`,
      '}, %)'
    )

    await checkCodeAtHoverPosition(
      'baseChamfer',
      baseChamfer,
      `angledLine([segAng(rectangleSegmentA001)-90,217.26],%,$seg01)chamfer({length:30,tags:[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)]},%)`,
      '}, %)'
    )

    await u.openAndClearDebugPanel()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: -6414, y: 160, z: 6145 },
        center: { x: 5919, y: 1236, z: 5251 },
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

    await page.mouse.click(nothing[0], nothing[1])

    await checkCodeAtHoverPosition(
      'adjacentChamfer1',
      adjacentChamfer1,
      `lineTo([profileStartX(%),profileStartY(%)],%,$seg02)chamfer({length:30,tags:[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)]},%)`,
      '}, %)'
    )

    await checkCodeAtHoverPosition(
      'adjacentChamfer2',
      adjacentChamfer2,
      `angledLine([segAng(rectangleSegmentA001),-segLen(rectangleSegmentA001)],%,$yo)chamfer({length:30,tags:[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)]},%)`,
      '}, %)'
    )
  })
  test("Extrude button should be disabled if there's no extrudable geometry when nothing is selected", async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([3.29, 7.86], %)
  |> line([2.48, 2.44], %)
  |> line([2.66, 1.17], %)
  |> line([3.75, 0.46], %)
  |> line([4.99, -0.46], %, $seg01)
  |> line([3.3, -2.12], %)
  |> line([2.16, -3.33], %)
  |> line([0.85, -3.08], %)
  |> line([-0.18, -3.36], %)
  |> line([-3.86, -2.73], %)
  |> line([-17.67, 0.85], %)
  |> close(%)
const extrude001 = extrude(10, sketch001)
  `
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const selectUnExtrudable = () =>
      page.getByText(`line([4.99, -0.46], %, $seg01)`).click()
    const clickEmpty = () => page.mouse.click(700, 460)
    await selectUnExtrudable()
    // expect extrude button to be disabled
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()

    await clickEmpty()

    // expect active line to contain nothing
    await expect(page.locator('.cm-activeLine')).toHaveText('')
    // and extrude to still be disabled
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()

    const codeToAdd = `${await u.codeLocator.allInnerTexts()}
const sketch002 = startSketchOn(extrude001, $seg01)
  |> startProfileAt([-12.94, 6.6], %)
  |> line([2.45, -0.2], %)
  |> line([-2, -1.25], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
`
    await u.codeLocator.fill(codeToAdd)

    await selectUnExtrudable()
    // expect extrude button to be disabled
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()

    await clickEmpty()
    await expect(page.locator('.cm-activeLine')).toHaveText('')
    // there's not extrudable geometry, so button should be enabled
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
  })

  test('Fillet button states test', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-5, -5], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`
      )
    })

    await page.setViewportSize({ width: 1000, height: 500 })
    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const selectSegment = () => page.getByText(`line([10, 0], %)`).click()
    const selectClose = () => page.getByText(`close(%)`).click()
    const clickEmpty = () => page.mouse.click(950, 100)

    // expect fillet button without any bodies in the scene
    await selectSegment()
    await expect(page.getByRole('button', { name: 'Fillet' })).toBeDisabled()
    await clickEmpty()
    await expect(page.getByRole('button', { name: 'Fillet' })).toBeDisabled()

    // test fillet button with the body in the scene
    const codeToAdd = `${await u.codeLocator.allInnerTexts()}
const extrude001 = extrude(10, sketch001)`
    await u.codeLocator.fill(codeToAdd)
    await selectSegment()
    await expect(page.getByRole('button', { name: 'Fillet' })).toBeEnabled()
    await selectClose()
    await expect(page.getByRole('button', { name: 'Fillet' })).toBeDisabled()
    await clickEmpty()
    await expect(page.getByRole('button', { name: 'Fillet' })).toBeEnabled()
  })

  const removeAfterFirstParenthesis = (inputString: string) => {
    const index = inputString.indexOf('(')
    if (index !== -1) {
      return inputString.substring(0, index)
    }
    return inputString // return the original string if '(' is not found
  }

  test('Testing selections (and hovers) work on sketches when NOT in sketch mode', async ({
    page,
  }) => {
    const cases = [
      {
        pos: [694, 185],
        expectedCode: 'line([74.36, 130.4], %, $seg01)',
      },
      {
        pos: [816, 244],
        expectedCode: 'angledLine([segAng(seg01), yo], %)',
      },
      {
        pos: [1107, 161],
        expectedCode: 'tangentialArcTo([167.95, -28.85], %)',
      },
    ] as const
    await page.addInitScript(
      async ({ cases }) => {
        localStorage.setItem(
          'persistCode',
          `const yo = 79
const part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> ${cases[0].expectedCode}
  |> line([-3.19, -138.43], %)
  |> ${cases[1].expectedCode}
  |> line([41.19, 28.97 + 5], %)
  |> ${cases[2].expectedCode}`
        )
      },
      { cases }
    )
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openAndClearDebugPanel()

    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: -449, y: -7503, z: 99 },
        center: { x: -449, y: 0, z: 99 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await u.waitForCmdReceive('default_camera_look_at')
    await u.clearAndCloseDebugPanel()

    // end setup, now test hover and selects
    for (const { pos, expectedCode } of cases) {
      // hover over segment, check it's content
      await page.mouse.move(pos[0], pos[1], { steps: 5 })
      await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
      await expect(page.getByTestId('hover-highlight').first()).toHaveText(
        expectedCode
      )
      // hover over segment, click it and check the cursor has move to the right place
      await page.mouse.click(pos[0], pos[1])
      await expect(page.locator('.cm-activeLine')).toHaveText(
        '|> ' + expectedCode
      )
    }
  })
  test("Hovering and selection of extruded faces works, and is not overridden shortly after user's click", async ({
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XZ')
  |> startProfileAt([-79.26, 95.04], %)
  |> line([112.54, 127.64], %)
  |> line([170.36, -121.61], %, $seg01)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(50, sketch001)
        `
      )
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openAndClearDebugPanel()

    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: { x: 6615, y: -9505, z: 10344 },
        center: { x: 1579, y: -635, z: 4035 },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await u.waitForCmdReceive('default_camera_look_at')
    await u.clearAndCloseDebugPanel()

    await page.waitForTimeout(1000)

    let noHoverColor: [number, number, number] = [92, 92, 92]
    let hoverColor: [number, number, number] = [127, 127, 127]
    let selectColor: [number, number, number] = [155, 155, 105]

    const extrudeWall = { x: 670, y: 275 }
    const extrudeText = `line([170.36, -121.61], %, $seg01)`

    const cap = { x: 594, y: 283 }
    const capText = `startProfileAt([-79.26, 95.04], %)`

    const nothing = { x: 946, y: 229 }

    await expect
      .poll(() => u.getGreatestPixDiff(extrudeWall, noHoverColor))
      .toBeLessThan(15)
    await page.mouse.move(nothing.x, nothing.y)
    await page.waitForTimeout(100)
    await page.mouse.move(extrudeWall.x, extrudeWall.y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await expect(page.getByTestId('hover-highlight').first()).toContainText(
      removeAfterFirstParenthesis(extrudeText)
    )
    await page.waitForTimeout(200)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, hoverColor)
    ).toBeLessThan(15)
    await page.mouse.click(extrudeWall.x, extrudeWall.y)
    await expect(page.locator('.cm-activeLine')).toHaveText(`|> ${extrudeText}`)
    await page.waitForTimeout(200)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, selectColor)
    ).toBeLessThan(15)
    await page.waitForTimeout(1000)
    // check color stays there, i.e. not overridden (this was a bug previously)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, selectColor)
    ).toBeLessThan(15)

    await page.mouse.move(nothing.x, nothing.y)
    await page.waitForTimeout(300)
    await expect(page.getByTestId('hover-highlight')).not.toBeVisible()

    // because of shading, color is not exact everywhere on the face
    noHoverColor = [115, 115, 115]
    hoverColor = [145, 145, 145]
    selectColor = [168, 168, 120]

    await expect(await u.getGreatestPixDiff(cap, noHoverColor)).toBeLessThan(15)
    await page.mouse.move(cap.x, cap.y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await expect(page.getByTestId('hover-highlight').first()).toContainText(
      removeAfterFirstParenthesis(capText)
    )
    await page.waitForTimeout(200)
    await expect(await u.getGreatestPixDiff(cap, hoverColor)).toBeLessThan(15)
    await page.mouse.click(cap.x, cap.y)
    await expect(page.locator('.cm-activeLine')).toHaveText(`|> ${capText}`)
    await page.waitForTimeout(200)
    await expect(await u.getGreatestPixDiff(cap, selectColor)).toBeLessThan(15)
    await page.waitForTimeout(1000)
    // check color stays there, i.e. not overridden (this was a bug previously)
    await expect(await u.getGreatestPixDiff(cap, selectColor)).toBeLessThan(15)
  })
  test("Various pipe expressions should and shouldn't allow edit and or extrude", async ({
    page,
  }) => {
    const u = await getUtils(page)
    const selectionsSnippets = {
      extrudeAndEditBlocked: '|> startProfileAt([10.81, 32.99], %)',
      extrudeAndEditBlockedInFunction: '|> startProfileAt(pos, %)',
      extrudeAndEditAllowed: '|> startProfileAt([15.72, 4.7], %)',
      editOnly: '|> startProfileAt([15.79, -14.6], %)',
    }
    await page.addInitScript(
      async ({
        extrudeAndEditBlocked,
        extrudeAndEditBlockedInFunction,
        extrudeAndEditAllowed,
        editOnly,
      }: any) => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    ${extrudeAndEditBlocked}
    |> line([25.96, 2.93], %)
    |> line([5.25, -5.72], %)
    |> line([-2.01, -10.35], %)
    |> line([-27.65, -2.78], %)
    |> close(%)
    |> extrude(5, %)
  const sketch002 = startSketchOn('XZ')
    ${extrudeAndEditAllowed}
    |> line([10.32, 6.47], %)
    |> line([9.71, -6.16], %)
    |> line([-3.08, -9.86], %)
    |> line([-12.02, -1.54], %)
    |> close(%)
  const sketch003 = startSketchOn('XZ')
    ${editOnly}
    |> line([27.55, -1.65], %)
    |> line([4.95, -8], %)
    |> line([-20.38, -10.12], %)
    |> line([-15.79, 17.08], %)

  fn yohey = (pos) => {
    const sketch004 = startSketchOn('XZ')
    ${extrudeAndEditBlockedInFunction}
    |> line([27.55, -1.65], %)
    |> line([4.95, -10.53], %)
    |> line([-20.38, -8], %)
    |> line([-15.79, 17.08], %)
    return ''
  }

      yohey([15.79, -34.6])
  `
        )
      },
      selectionsSnippets
    )
    await page.setViewportSize({ width: 1200, height: 1000 })

    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // wait for start sketch as a proxy for the stream being ready
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.getByText(selectionsSnippets.extrudeAndEditBlocked).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()

    await page.getByText(selectionsSnippets.extrudeAndEditAllowed).click()
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeDisabled()

    await page.getByText(selectionsSnippets.editOnly).click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeDisabled()

    await page
      .getByText(selectionsSnippets.extrudeAndEditBlockedInFunction)
      .click()
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeVisible()
  })

  test('Deselecting line tool should mean nothing happens on click', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()

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

    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `const sketch001 = startSketchOn('XZ')`
    )

    await page.waitForTimeout(600)

    let previousCodeContent = await page.locator('.cm-content').innerText()

    // deselect the line tool by clicking it
    await page.getByRole('button', { name: 'line Line', exact: true }).click()

    await page.mouse.click(700, 200)
    await page.waitForTimeout(100)
    await page.mouse.click(700, 250)
    await page.waitForTimeout(100)
    await page.mouse.click(750, 200)
    await page.waitForTimeout(100)

    // expect no change
    await expect(page.locator('.cm-content')).toHaveText(previousCodeContent)

    // select line tool again
    await page.getByRole('button', { name: 'line Line', exact: true }).click()

    await u.closeDebugPanel()

    // line tool should work as expected again
    await page.mouse.click(700, 200)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(100)
    await page.mouse.click(700, 300)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(100)
    await page.mouse.click(750, 300)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()
  })
})
