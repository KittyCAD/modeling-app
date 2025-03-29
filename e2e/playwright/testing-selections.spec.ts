import type { Coords2d } from '@src/lang/std/sketch'
import { KCL_DEFAULT_LENGTH } from '@src/lib/constants'
import { uuidv4 } from '@src/lib/utils'

import {
  commonPoints,
  getUtils,
  orRunWhenFullSuiteEnabled,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Testing selections', { tag: ['@skipWin'] }, () => {
  test.setTimeout(90_000)
  test('Selections work on fresh and edited sketch', async ({
    page,
    homePage,
    toolbar,
  }) => {
    // tests mapping works on fresh sketch and edited sketch
    // tests using hovers which is the same as selections, because if
    // source ranges are wrong, hovers won't work
    const u = await getUtils(page)
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await u.openDebugPanel()

    const yAxisClick = () =>
      test.step('Click on Y axis', async () => {
        await page.mouse.move(600, 200, { steps: 5 })
        await page.mouse.click(600, 200)
        await page.waitForTimeout(100)
      })
    const xAxisClickAfterExitingSketch = () =>
      test.step(`Click on X axis after exiting sketch, which shifts it at the moment`, async () => {
        await page.mouse.click(639, 278)
        await page.waitForTimeout(100)
      })
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
    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)profile001 = startProfileAt(${commonPoints.startAt}, sketch001)`
    )

    await page.waitForTimeout(100)
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

    await expect(page.locator('.cm-content'))
      .toHaveText(`@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)profile001 = startProfileAt(${commonPoints.startAt}, sketch001)
    |> xLine(length = ${commonPoints.num1})`)

    await page.waitForTimeout(100)
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)profile001 = startProfileAt(${
      commonPoints.startAt
    }, sketch001)
    |> xLine(length = ${commonPoints.num1})
    |> yLine(length = ${commonPoints.num1 + 0.01})`)
    await page.waitForTimeout(100)
    await page.mouse.click(startXPx, 500 - PUR * 20)
    await expect(page.locator('.cm-content'))
      .toHaveText(`@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)profile001 = startProfileAt(${
      commonPoints.startAt
    }, sketch001)
    |> xLine(length = ${commonPoints.num1})
    |> yLine(length = ${commonPoints.num1 + 0.01})
    |> xLine(length = ${commonPoints.num2 * -1})`)

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
      const constrainButton = page.getByRole('button', {
        name: 'Length: open menu',
      })
      const absXButton = page.getByRole('button', { name: 'Absolute X' })

      await test.step(`Select a segment and an axis, see that a relevant constraint is enabled`, async () => {
        await topHorzSegmentClick()
        await page.keyboard.down('Shift')
        await constrainButton.click()
        await expect(absXButton).toBeDisabled()
        await page.waitForTimeout(100)
        await yAxisClick()
        await page.keyboard.up('Shift')
        await constrainButton.click()
        await absXButton.and(page.locator(':not([disabled])')).waitFor()
        await expect(absXButton).not.toBeDisabled()
      })

      await emptySpaceClick()
      await page.waitForTimeout(100)

      await test.step(`Same selection but click the axis first`, async () => {
        await yAxisClick()
        await constrainButton.click()
        await expect(absXButton).toBeDisabled()
        await page.keyboard.down('Shift')
        await page.waitForTimeout(100)
        await topHorzSegmentClick()
        await page.waitForTimeout(100)

        await page.keyboard.up('Shift')
        await constrainButton.click()
        await expect(absXButton).not.toBeDisabled()
      })

      // clear selection by clicking on nothing
      await emptySpaceClick()

      // check the same selection again by putting cursor in code first then selecting axis
      await test.step(`Same selection but code selection then axis`, async () => {
        await page
          .getByText(`  |> xLine(length = ${commonPoints.num2 * -1})`)
          .click()
        await page.keyboard.down('Shift')
        await constrainButton.click()
        await expect(absXButton).toBeDisabled()
        await page.waitForTimeout(100)
        await yAxisClick()
        await page.keyboard.up('Shift')
        await constrainButton.click()
        await expect(absXButton).not.toBeDisabled()
      })

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
      await page
        .getByText(`  |> xLine(length = ${commonPoints.num2 * -1})`)
        .click()

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
    await toolbar.editSketch()

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

  test('Solids should be select and deletable', async ({
    page,
    homePage,
    scene,
    cmdBar,
  }) => {
    test.setTimeout(90_000)
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
  |> startProfileAt([-79.26, 95.04], %)
  |> line(end = [112.54, 127.64], tag = $seg02)
  |> line(end = [170.36, -121.61], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 50)
sketch005 = startSketchOn(extrude001, 'END')
  |> startProfileAt([23.24, 136.52], %)
  |> line(end = [-8.44, 36.61])
  |> line(end = [49.4, 2.05])
  |> line(end = [29.69, -46.95])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(extrude001, seg01)
  |> startProfileAt([21.23, 17.81], %)
  |> line(end = [51.97, 21.32])
  |> line(end = [4.07, -22.75])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch002 = startSketchOn(extrude001, seg02)
  |> startProfileAt([-100.54, 16.99], %)
  |> line(end = [0, 20.03])
  |> line(end = [62.61, 0], tag = $seg03)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = 50)
sketch004 = startSketchOn(extrude002, seg03)
  |> startProfileAt([57.07, 134.77], %)
  |> line(end = [-4.72, 22.84])
  |> line(end = [28.8, 6.71])
  |> line(end = [9.19, -25.33])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude003 = extrude(sketch004, length = 20)
pipeLength = 40
pipeSmallDia = 10
pipeLargeDia = 20
thickness = 0.5
part009 = startSketchOn(XY)
  |> startProfileAt([pipeLargeDia - (thickness / 2), 38], %)
  |> line(end = [thickness, 0])
  |> line(end = [0, -1])
  |> angledLineToX({
       angle = 60,
       to = pipeSmallDia + thickness
     }, %)
  |> line(end = [0, -pipeLength])
  |> angledLineToX({
       angle = -60,
       to = pipeLargeDia + thickness
     }, %)
  |> line(end = [0, -1])
  |> line(end = [-thickness, 0])
  |> line(end = [0, 1])
  |> angledLineToX({ angle = 120, to = pipeSmallDia }, %)
  |> line(end = [0, pipeLength])
  |> angledLineToX({ angle = 60, to = pipeLargeDia }, %)
  |> close()
rev = revolve(part009, axis = Y)
sketch006 = startSketchOn(XY)
profile001 = circle(
  sketch006,
  center = [42.91, -70.42],
  radius = 17.96
)
profile002 = startProfileAt([86.92, -63.81], sketch006)
  |> angledLine([0, 63.81], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       17.05
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
profile003 = startProfileAt([40.16, -120.48], sketch006)
  |> line(end = [26.95, 24.21])
  |> line(end = [20.91, -28.61])
  |> line(end = [32.46, 18.71])

`
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    const camPosition1 = async () => {
      await scene.moveCameraTo(
        { x: 1139.49, y: -7053, z: 8597.31 },
        { x: -2206.68, y: -1298.36, z: 60 }
      )
    }
    await camPosition1()

    const revolve = { x: 635, y: 253 }
    const solid2d = { x: 770, y: 167 }
    const individualProfile = { x: 694, y: 432 }

    // DELETE REVOLVE
    await page.mouse.click(revolve.x, revolve.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line(end = [0, -pipeLength])'
    )
    await u.openAndClearDebugPanel()
    await page.keyboard.press('Delete')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)

    await expect(u.codeLocator).not.toContainText(
      `rev = revolve(part009, axis: Y)`
    )

    // FIXME (commented section below), this test would select a wall that had a sketch on it, and delete the underlying extrude
    // and replace the sketch on face with a hard coded custom plane, but since there was a sketch on that plane maybe it
    // should have delete the sketch? it's broken atm, but not sure if worth fixing since desired behaviour is a little
    // vague
    // DELETE PARENT EXTRUDE
    //   await camPosition2()
    //   await page.mouse.click(parentExtrude.x, parentExtrude.y)
    //   await page.waitForTimeout(100)
    //   await expect(page.locator('.cm-activeLine')).toHaveText(
    //     '|> line(end = [112.54, 127.64], tag = $seg02)'
    //   )
    //   await u.clearCommandLogs()
    //   await page.keyboard.press('Backspace')
    //   await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    //   await page.waitForTimeout(200)
    //   await expect(u.codeLocator).not.toContainText(
    //     `extrude001 = extrude(sketch001, length = 50)`
    //   )
    //   await expect(u.codeLocator).toContainText(`sketch005 = startSketchOn({
    //    plane = {
    //      origin = { x = 0, y = -50, z = 0 },
    //      xAxis = { x = 1, y = 0, z = 0 },
    //      yAxis = { x = 0, y = 0, z = 1 },
    //      zAxis = { x = 0, y = -1, z = 0 }
    //    }
    //  })`)
    //   await expect(u.codeLocator).toContainText(`sketch003 = startSketchOn({
    //    plane = {
    //      origin = { x = 116.53, y = 0, z = 163.25 },
    //      xAxis = { x = -0.81, y = 0, z = 0.58 },
    //      yAxis = { x = 0, y = -1, z = 0 },
    //      zAxis = { x = 0.58, y = 0, z = 0.81 }
    //    }
    //  })`)
    //   await expect(u.codeLocator).toContainText(`sketch002 = startSketchOn({
    //    plane = {
    //      origin = { x = -91.74, y = 0, z = 80.89 },
    //      xAxis = { x = -0.66, y = 0, z = -0.75 },
    //      yAxis = { x = 0, y = -1, z = 0 },
    //      zAxis = { x = -0.75, y = 0, z = 0.66 }
    //    }
    //  })`)

    // DELETE SOLID 2D
    await page.mouse.click(solid2d.x, solid2d.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> startProfileAt([23.24, 136.52], %)'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Delete')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)
    await expect(u.codeLocator).not.toContainText(`sketch005 = startSketchOn({`)

    // Delete a single profile
    await page.mouse.click(individualProfile.x, individualProfile.y)
    await page.waitForTimeout(100)
    const codeToBeDeletedSnippet =
      'profile003 = startProfileAt([40.16, -120.48], sketch006)'
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '  |> line(end = [20.91, -28.61])'
    )
    await u.clearCommandLogs()
    await page.keyboard.press('Delete')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)
    await expect(u.codeLocator).not.toContainText(codeToBeDeletedSnippet)
  })
  test('parent Solid should be select and deletable and uses custom planes to position children', async ({
    page,
    homePage,
    scene,
    cmdBar,
    editor,
  }) => {
    test.fixme(orRunWhenFullSuiteEnabled())
    test.setTimeout(90_000)
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn(XY)
yo = startProfileAt([4.83, 12.56], part001)
  |> line(end = [15.1, 2.48])
  |> line(end = [3.15, -9.85], tag = $seg01)
  |> line(end = [-15.17, -4.1])
  |> angledLine([segAng(seg01), 12.35], %, $seg02)
  |> line(end = [-13.02, 10.03])
  |> close()
yoo = extrude(yo, length = 4)
sketch002 = startSketchOn(yoo, seg02)
sketch001 = startSketchOn(yoo, 'END')
profile002 = startProfileAt([-11.08, 2.39], sketch002)
  |> line(end = [4.89, 0.9])
  |> line(end = [-0.61, -2.41])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile002, length = 15)
profile001 = startProfileAt([7.49, 9.96], sketch001)
  |> angledLine([0, 5.05], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       4.81
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

`
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const extrudeWall = { x: 575, y: 238 }

    // DELETE with selection on face of parent
    await page.mouse.click(extrudeWall.x, extrudeWall.y)
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      '|> line(end = [-15.17, -4.1])'
    )
    await u.openAndClearDebugPanel()
    await page.keyboard.press('Delete')
    await u.expectCmdLog('[data-message-type="execution-done"]', 10_000)
    await page.waitForTimeout(200)

    await editor.expectEditor.not.toContain(`yoo = extrude(yo, length = 4)`, {
      shouldNormalise: true,
    })
    await editor.expectEditor.toContain(`startSketchOn({plane={origin`, {
      shouldNormalise: true,
    })
    await editor.snapshot()
  })
  test('Hovering over 3d features highlights code, clicking puts the cursor in the right place and sends selection id to engine', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.addInitScript(async (KCL_DEFAULT_LENGTH) => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
part001 = startSketchOn(XZ)
  |> startProfileAt([20, 0], %)
  |> line(end = [7.13, 4 + 0])
  |> angledLine({ angle = 3 + 0, length = 3.14 + 0 }, %)
  |> line(endAbsolute = [20.14 + 0, -0.14 + 0])
  |> xLine(endAbsolute = 29 + 0)
  |> yLine(length = -3.14 + 0, tag = $a)
  |> xLine(length = 1.63)
  |> angledLineOfXLength({ angle = 3 + 0, length = 3.14 }, %)
  |> angledLineOfYLength({ angle = 30, length = 3 + 0 }, %)
  |> angledLineToX({ angle = 22.14 + 0, to = 12 }, %)
  |> angledLineToY({ angle = 30, to = 11.14 }, %)
  |> angledLineThatIntersects({
        angle = 3.14,
        intersectTag = a,
        offset = 0
      }, %)
  |> tangentialArcTo([13.14 + 0, 13.14], %)
  |> close()
  |> extrude(length = 5 + 7)
    `
      )
    }, KCL_DEFAULT_LENGTH)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()

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
      `angledLineThatIntersects({angle=3.14,intersectTag=a,offset=0},%)extrude(length=5+7)`,
      '}, %)'
    )

    await checkCodeAtHoverPosition(
      'tangentialArcTo',
      tangentialArcTo,
      'tangentialArcTo([13.14+0,13.14],%)extrude(length=5+7)',
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
      'close()extrude(length=5+7)',
      'close()'
    )
    await checkCodeAtHoverPosition('closeEdge', closeEdge, `close()`, 'close()')
    await checkCodeAtHoverPosition(
      'closeAdjacentEdge',
      closeAdjacentEdge,
      `close()`,
      'close()'
    )
    await checkCodeAtHoverPosition(
      'closeOppositeEdge',
      closeOppositeEdge,
      `close()`,
      'close()'
    )

    await checkCodeAtHoverPosition(
      'straightSegmentEdge',
      straightSegmentEdge,
      `angledLineToY({angle=30,to=11.14},%)`,
      'angledLineToY({ angle = 30, to = 11.14 }, %)'
    )
    await checkCodeAtHoverPosition(
      'straightSegmentOppositeEdge',
      straightSegmentOppositeEdge,
      `angledLineToY({angle=30,to=11.14},%)`,
      'angledLineToY({ angle = 30, to = 11.14 }, %)'
    )
    await checkCodeAtHoverPosition(
      'straightSegmentAdjacentEdge',
      straightSegmentAdjacentEdge,
      `angledLineThatIntersects({angle=3.14,intersectTag=a,offset=0},%)`,
      '}, %)'
    )

    await page.waitForTimeout(200)

    await u.removeCurrentCode()
    await u.codeLocator.fill(`@settings(defaultLengthUnit = in)
    sketch001 = startSketchOn(XZ)
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
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $seg02)
    |> close()
  extrude001 = extrude(sketch001, length = 100)
    |> chamfer(
     length = 30,
     tags = [
       seg01,
       getNextAdjacentEdge(yo),
       getNextAdjacentEdge(seg02),
       getOppositeEdge(seg01)
     ],
   )
  `)

    await expect(
      page
        .getByTestId('model-state-indicator-receive-reliable')
        .or(page.getByTestId('model-state-indicator-execution-done'))
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
      `angledLine([segAng(rectangleSegmentA001)-90,217.26],%,$seg01)chamfer(length=30,tags=[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)],)`,
      '   )'
    )

    await checkCodeAtHoverPosition(
      'baseChamfer',
      baseChamfer,
      `angledLine([segAng(rectangleSegmentA001)-90,217.26],%,$seg01)chamfer(length=30,tags=[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)],)`,
      '   )'
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
      `line(endAbsolute=[profileStartX(%),profileStartY(%)],tag=$seg02)chamfer(length=30,tags=[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)],)`,
      '   )'
    )

    await checkCodeAtHoverPosition(
      'adjacentChamfer2',
      adjacentChamfer2,
      `angledLine([segAng(rectangleSegmentA001),-segLen(rectangleSegmentA001)],%,$yo)chamfer(length=30,tags=[seg01,getNextAdjacentEdge(yo),getNextAdjacentEdge(seg02),getOppositeEdge(seg01)],)`,
      '   )'
    )
  })
  test("Extrude button should be disabled if there's no extrudable geometry when nothing is selected", async ({
    page,
    editor,
    homePage,
  }) => {
    const u = await getUtils(page)

    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XZ)
    |> startProfileAt([3.29, 7.86], %)
    |> line(end = [2.48, 2.44])
    |> line(end = [2.66, 1.17])
    |> line(end = [3.75, 0.46])
    |> line(end = [4.99, -0.46], tag = $seg01)
    |> line(end = [3.3, -2.12])
    |> line(end = [2.16, -3.33])
    |> line(end = [0.85, -3.08])
    |> line(end = [-0.18, -3.36])
    |> line(end = [-3.86, -2.73])
    |> line(end = [-17.67, 0.85])
    |> close()
  extrude001 = extrude(sketch001, length = 10)
    `
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const selectUnExtrudable = async () => {
      await editor.scrollToText(`line(end = [4.99, -0.46], tag = $seg01)`)
      await page.getByText(`line(end = [4.99, -0.46], tag = $seg01)`).click()
    }
    const clickEmpty = () => page.mouse.click(700, 460)
    await selectUnExtrudable()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()

    await clickEmpty()

    // expect active line to contain nothing
    await expect(page.locator('.cm-activeLine')).toHaveText('')

    const codeToAdd = `${await u.codeLocator.allInnerTexts()}
  sketch002 = startSketchOn(extrude001, $seg01)
    |> startProfileAt([-12.94, 6.6], %)
    |> line(end = [2.45, -0.2])
    |> line(end = [-2, -1.25])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  `
    await u.codeLocator.fill(codeToAdd)

    await selectUnExtrudable()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()

    await clickEmpty()
    await expect(page.locator('.cm-activeLine')).toHaveText('')
    // there's not extrudable geometry, so button should be enabled
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
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
    homePage,
    scene,
  }) => {
    const cases = [
      {
        pos: [694, 185],
        expectedCode: 'line(end = [74.36, 130.4], tag = $seg01)',
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
          `@settings(defaultLengthUnit = in)
  yo = 79
  part001 = startSketchOn(XZ)
    |> startProfileAt([-7.54, -26.74], %)
    |> ${cases[0].expectedCode}
    |> line(end = [-3.19, -138.43])
    |> ${cases[1].expectedCode}
    |> line(end = [41.19, 28.97 + 5])
    |> ${cases[2].expectedCode}`
        )
      },
      { cases }
    )
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()
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
    homePage,
    scene,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
  sketch001 = startSketchOn(XZ)
    |> startProfileAt([-79.26, 95.04], %)
    |> line(end = [112.54, 127.64])
    |> line(end = [170.36, -121.61], tag = $seg01)
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(sketch001, length = 50)
      `
      )
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.waitForExecutionDone()
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
    const extrudeText = `line(end = [170.36, -121.61], tag = $seg01)`

    const cap = { x: 594, y: 283 }
    const capText = `startProfileAt([-79.26, 95.04], %)`

    const nothing = { x: 946, y: 229 }

    await expect
      .poll(() => u.getGreatestPixDiff(extrudeWall, noHoverColor))
      .toBeLessThan(15)
    await page.mouse.move(nothing.x, nothing.y)
    await page.waitForTimeout(1000)
    await page.mouse.move(extrudeWall.x, extrudeWall.y)
    await expect(page.getByTestId('hover-highlight').first()).toBeVisible()
    await expect(page.getByTestId('hover-highlight').first()).toContainText(
      removeAfterFirstParenthesis(extrudeText)
    )
    await page.waitForTimeout(1000)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, hoverColor)
    ).toBeLessThan(15)
    await page.mouse.click(extrudeWall.x, extrudeWall.y)
    await expect(page.locator('.cm-activeLine')).toHaveText(`|> ${extrudeText}`)
    await page.waitForTimeout(1000)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, selectColor)
    ).toBeLessThan(15)
    await page.waitForTimeout(1000)
    // check color stays there, i.e. not overridden (this was a bug previously)
    await expect(
      await u.getGreatestPixDiff(extrudeWall, selectColor)
    ).toBeLessThan(15)

    await page.mouse.move(nothing.x, nothing.y)
    await page.waitForTimeout(1000)
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
    await page.waitForTimeout(1000)
    await expect(await u.getGreatestPixDiff(cap, hoverColor)).toBeLessThan(15)
    await page.mouse.click(cap.x, cap.y)
    await expect(page.locator('.cm-activeLine')).toHaveText(`|> ${capText}`)
    await page.waitForTimeout(1000)
    await expect(await u.getGreatestPixDiff(cap, selectColor)).toBeLessThan(15)
    await page.waitForTimeout(1000)
    // check color stays there, i.e. not overridden (this was a bug previously)
    await expect(await u.getGreatestPixDiff(cap, selectColor)).toBeLessThan(15)
  })
  test("Various pipe expressions should and shouldn't allow edit and or extrude", async ({
    page,
    homePage,
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
          `part001 = startSketchOn(XZ)
  ${extrudeAndEditBlocked}
  |> line(end = [25.96, 2.93])
  |> line(end = [5.25, -5.72])
  |> line(end = [-2.01, -10.35])
  |> line(end = [-27.65, -2.78])
  |> close()
  |> extrude(length = 5)
    sketch002 = startSketchOn(XZ)
  ${extrudeAndEditAllowed}
  |> line(end = [10.32, 6.47])
  |> line(end = [9.71, -6.16])
  |> line(end = [-3.08, -9.86])
  |> line(end = [-12.02, -1.54])
  |> close()
    sketch003 = startSketchOn(XZ)
  ${editOnly}
  |> line(end = [27.55, -1.65])
  |> line(end = [4.95, -8])
  |> line(end = [-20.38, -10.12])
  |> line(end = [-15.79, 17.08])

    fn yohey = (pos) => {
  sketch004 = startSketchOn(XZ)
  ${extrudeAndEditBlockedInFunction}
  |> line(end = [27.55, -1.65])
  |> line(end = [4.95, -10.53])
  |> line(end = [-20.38, -8])
  |> line(end = [-15.79, 17.08])
  return ''
    }

    yohey([15.79, -34.6])
    `
        )
      },
      selectionsSnippets
    )
    await page.setBodyDimensions({ width: 1200, height: 1000 })

    await homePage.goToModelingScene()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // wait for start sketch as a proxy for the stream being ready
    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.getByText(selectionsSnippets.extrudeAndEditBlocked).click()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()

    await page.getByText(selectionsSnippets.extrudeAndEditAllowed).click()
    await expect(
      page.getByRole('button', { name: 'Extrude' })
    ).not.toBeDisabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeDisabled()

    await page.getByText(selectionsSnippets.editOnly).click()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeDisabled()

    await page
      .getByText(selectionsSnippets.extrudeAndEditBlockedInFunction)
      .click()
    // expect extrude button to be enabled, since we don't guard
    // until the extrude button is clicked
    await expect(page.getByRole('button', { name: 'Extrude' })).toBeEnabled()
    await expect(
      page.getByRole('button', { name: 'Edit Sketch' })
    ).not.toBeVisible()
  })

  test('Deselecting line tool should mean nothing happens on click', async ({
    page,
    homePage,
  }) => {
    /**
     * If the line tool is clicked when the state is 'No Points' it will exit Sketch mode.
     * This is the same exact workflow as pressing ESC.
     *
     * To continue to test this workflow, we now enter sketch mode and place a single point before exiting the line tool.
     */
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
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

    // Clicks the XZ Plane in the page
    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)`
    )

    await page.waitForTimeout(600)

    const firstClickCoords = { x: 650, y: 200 } as const
    // Place a point because the line tool will exit if no points are pressed
    await page.mouse.click(firstClickCoords.x, firstClickCoords.y)
    await page.waitForTimeout(600)

    // Code before exiting the tool
    let previousCodeContent = (
      await page.locator('.cm-content').innerText()
    ).replace(/\s+/g, '')

    // deselect the line tool by clicking it
    await page.getByRole('button', { name: 'line Line', exact: true }).click()

    await page.mouse.click(700, 200)
    await page.waitForTimeout(100)
    await page.mouse.click(700, 250)
    await page.waitForTimeout(100)
    await page.mouse.click(750, 200)
    await page.waitForTimeout(100)

    await expect
      .poll(async () => {
        let str = await page.locator('.cm-content').innerText()
        str = str.replace(/\s+/g, '')
        return str
      })
      .toBe(previousCodeContent)

    // select line tool again
    await page.getByRole('button', { name: 'line Line', exact: true }).click()

    await u.closeDebugPanel()

    // Click to continue profile
    await page.mouse.click(firstClickCoords.x, firstClickCoords.y)
    await page.waitForTimeout(100)

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
