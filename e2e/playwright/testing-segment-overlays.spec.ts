import type { Page } from '@playwright/test'
import type { LineInputsType } from '@src/lang/std/sketchcombos'
import { uuidv4 } from '@src/lib/utils'

import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import { deg, getUtils, wiggleMove } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Testing segment overlays', () => {
  test.describe('Hover over a segment should show its overlay, hovering over the input overlays should show its popover, clicking the input overlay should constrain/unconstrain it', () => {
    /**
     * Clicks on an constrained element
     * @param {Page} page - The page to perform the action on
     * @param {Object} options - The options for the action
     * @param {Object} options.hoverPos - The position to hover over
     * @param {Object} options.constraintType - The type of constraint
     * @param {number} options.ang - The angle
     * @param {number} options.steps - The number of steps to perform
     */
    const _clickConstrained =
      (page: Page, editor: EditorFixture) =>
      async ({
        hoverPos,
        constraintType,
        expectBeforeUnconstrained,
        expectAfterUnconstrained,
        expectFinal,
        ang = 45,
        steps = 10,
        locator,
      }: {
        hoverPos: { x: number; y: number }
        constraintType:
          | 'horizontal'
          | 'vertical'
          | 'tangentialWithPrevious'
          | LineInputsType
        expectBeforeUnconstrained: string
        expectAfterUnconstrained: string
        expectFinal: string
        ang?: number
        steps?: number
        locator?: string
      }) => {
        await expect(page.getByText('Added variable')).not.toBeVisible()

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)
        await page.mouse.move(x, y)

        await editor.expectEditor.toContain(expectBeforeUnconstrained, {
          shouldNormalise: true,
        })
        const constrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="true"]`
        )
        await expect(constrainedLocator).toBeVisible()
        await constrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await constrainedLocator.click()
        await editor.expectEditor.toContain(expectAfterUnconstrained, {
          shouldNormalise: true,
        })

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)
        await page.mouse.move(x, y)

        const unconstrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="false"]`
        )
        await expect(unconstrainedLocator).toBeVisible()
        await unconstrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await unconstrainedLocator.click()
        await expect(
          page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
        ).toBeFocused()
        await page
          .getByRole('button', {
            name: 'arrow right Continue',
          })
          .click()
        await expect(page.locator('.cm-content')).toContainText(expectFinal)
        await editor.expectEditor.toContain(expectFinal, {
          shouldNormalise: true,
        })
        await editor.expectEditor.toContain(expectFinal, {
          shouldNormalise: true,
        })
      }

    /**
     * Clicks on an unconstrained element
     * @param {Page} page - The page to perform the action on
     * @param {Object} options - The options for the action
     * @param {Object} options.hoverPos - The position to hover over
     * @param {Object} options.constraintType - The type of constraint
     * @param {number} options.ang - The angle
     * @param {number} options.steps - The number of steps to perform
     */
    const _clickUnconstrained =
      (page: Page, editor: EditorFixture) =>
      async ({
        hoverPos,
        constraintType,
        expectBeforeUnconstrained,
        expectAfterUnconstrained,
        expectFinal,
        ang = 45,
        steps = 5,
        locator,
      }: {
        hoverPos: { x: number; y: number }
        constraintType:
          | 'horizontal'
          | 'vertical'
          | 'tangentialWithPrevious'
          | LineInputsType
        expectBeforeUnconstrained: string
        expectAfterUnconstrained: string
        expectFinal: string
        ang?: number
        steps?: number
        locator?: string
      }) => {
        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)
        await page.mouse.move(x, y)

        await expect(page.getByText('Added variable')).not.toBeVisible()
        await editor.expectEditor.toContain(expectBeforeUnconstrained, {
          shouldNormalise: true,
        })
        const unconstrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="false"]`
        )
        await unconstrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await unconstrainedLocator.click()
        await expect(
          page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
        ).toBeFocused()
        await page
          .getByRole('button', {
            name: 'arrow right Continue',
          })
          .click()
        await editor.expectEditor.toContain(expectAfterUnconstrained, {
          shouldNormalise: true,
        })
        await expect(page.getByText('Added variable')).not.toBeVisible()

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)
        await page.mouse.move(x, y)

        const constrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="true"]`
        )
        await expect(constrainedLocator).toBeVisible()
        await constrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await constrainedLocator.click()
        await editor.expectEditor.toContain(expectFinal, {
          shouldNormalise: true,
        })
      }
    test.setTimeout(120000)
    test('for segments [line, angledLine, xLineTo]', async ({
      page,
      editor,
      homePage,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
      part001 = startSketchOn(XZ)
        |> startProfile(at = [5 + 0, 20 + 0])
        |> line(end = [0.5, -14 + 0])
        |> angledLine(angle = 3 + 0, length = 32 + 0)
        |> line(endAbsolute = [5 + 33, 20 + 11.5 + 0])
        |> xLine(endAbsolute = 5 + 9 - 5)
        |> yLine(endAbsolute = 20 + -10.77, tag = $a)
        |> xLine(length = 26.04)
        |> yLine(length = 21.14 + 0)
        |> angledLine(angle = 181 + 0, lengthX = 23.14)
        |> angledLine(angle = -91, lengthY = 19 + 0)
        |> angledLine(angle = 3 + 0, endAbsoluteX = 5 + 26)
        |> angledLine(angle = 89, endAbsoluteY = 20 + 9.14 + 0)
        |> angledLineThatIntersects(angle = 4.14, intersectTag = a, offset = 9)
        |> tangentialArc(endAbsolute = [5 + 3.14 + 13, 20 + 3.14])
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

      await page.getByText('xLine(endAbsolute = 5 + 9 - 5)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page, editor)
      const clickConstrained = _clickConstrained(page, editor)

      await u.openAndClearDebugPanel()
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          vantage: { x: 80, y: -1350, z: 510 },
          center: { x: 80, y: 0, z: 510 },
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

      let ang = 0

      const line = await u.getBoundingBox('[data-overlay-index="0"]')
      ang = await u.getAngle('[data-overlay-index="0"]')
      console.log('line1', line, ang)
      await clickConstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: '|> line(end = [0.5, -14 + 0])',
        expectAfterUnconstrained: '|> line(end = [0.5, -14])',
        expectFinal: '|> line(end = [0.5, yRel001])',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="0"]',
      })
      console.log('line2')
      await clickUnconstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained: '|> line(end = [0.5, yRel001])',
        expectAfterUnconstrained: 'line(end = [xRel001, yRel001])',
        expectFinal: '|> line(end = [0.5, yRel001])',
        ang: ang + 180,
        locator: '[data-overlay-index="0"]',
      })

      const angledLine = await u.getBoundingBox('[data-overlay-index="1"]')
      ang = await u.getAngle('[data-overlay-index="1"]')
      console.log('angledLine1')
      await clickConstrained({
        hoverPos: { x: angledLine.x, y: angledLine.y },
        constraintType: 'angle',
        expectBeforeUnconstrained: 'angledLine(angle = 3 + 0, length = 32 + 0)',
        expectAfterUnconstrained: 'angledLine(angle = 3, length = 32 + 0)',
        expectFinal: 'angledLine(angle = angle001, length = 32 + 0)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })
      console.log('angledLine2')
      await clickConstrained({
        hoverPos: { x: angledLine.x, y: angledLine.y },
        constraintType: 'length',
        expectBeforeUnconstrained:
          'angledLine(angle = angle001, length = 32 + 0)',
        expectAfterUnconstrained: 'angledLine(angle = angle001, length = 32)',
        expectFinal: 'angledLine(angle = angle001, length = len001)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      await page.mouse.move(700, 250)
      await page.waitForTimeout(100)

      let lineTo = await u.getBoundingBox('[data-overlay-index="2"]')
      ang = await u.getAngle('[data-overlay-index="2"]')
      console.log('lineTo1')
      await clickConstrained({
        hoverPos: { x: lineTo.x, y: lineTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained:
          'line(endAbsolute = [5 + 33, 20 + 11.5 + 0])',
        expectAfterUnconstrained: 'line(endAbsolute = [5 + 33, 31.5])',
        expectFinal: 'line(endAbsolute = [5 + 33, yAbs001])',
        steps: 8,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="2"]',
      })
      console.log('lineTo2')
      await clickConstrained({
        hoverPos: { x: lineTo.x, y: lineTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'line(endAbsolute = [5 + 33, yAbs001])',
        expectAfterUnconstrained: 'line(endAbsolute = [38, yAbs001])',
        expectFinal: 'line(endAbsolute = [xAbs001, yAbs001])',
        steps: 8,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="2"]',
      })

      const xLineTo = await u.getBoundingBox('[data-overlay-index="3"]')
      ang = await u.getAngle('[data-overlay-index="3"]')
      console.log('xlineTo1')
      await clickConstrained({
        hoverPos: { x: xLineTo.x, y: xLineTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'xLine(endAbsolute = 5 + 9 - 5)',
        expectAfterUnconstrained: 'xLine(endAbsolute = 9)',
        expectFinal: 'xLine(endAbsolute = xAbs002)',
        ang: ang + 180,
        steps: 8,
        locator: '[data-overlay-toolbar-index="3"]',
      })
    })

    // Broken on main at time of writing!
    test('for segments [yLineTo, xLine]', async ({
      page,
      editor,
      homePage,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
    yRel001 = -14
    xRel001 = 0.5
    angle001 = 3
    len001 = 32
    yAbs001 = 11.5
    xAbs001 = 33
    xAbs002 = 4
    part001 = startSketchOn(XZ)
      |> startProfile(at = [0, 0])
      |> line(end = [0.5, yRel001])
      |> angledLine(angle = angle001, length = len001)
      |> line(endAbsolute = [33, yAbs001])
      |> xLine(endAbsolute = xAbs002)
      |> yLine(endAbsolute = -10.77, tag = $a)
      |> xLine(length = 26.04)
      |> yLine(length = 21.14 + 0)
      |> angledLine(angle = 181 + 0, lengthX = 23.14)
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

      await page.getByText('xLine(length = 26.04)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(8)

      const clickUnconstrained = _clickUnconstrained(page, editor)

      await page.mouse.move(700, 250)
      await page.waitForTimeout(100)

      let ang = 0

      const yLineTo = await u.getBoundingBox('[data-overlay-index="4"]')
      ang = await u.getAngle('[data-overlay-index="4"]')
      console.log('ylineTo1')
      await clickUnconstrained({
        hoverPos: { x: yLineTo.x, y: yLineTo.y - 200 },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'yLine(endAbsolute = -10.77, tag = $a)',
        expectAfterUnconstrained: 'yLine(endAbsolute = yAbs002, tag = $a)',
        expectFinal: 'yLine(endAbsolute = -10.77, tag = $a)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="4"]',
      })

      const xLine = await u.getBoundingBox('[data-overlay-index="5"]')
      ang = await u.getAngle('[data-overlay-index="5"]')
      console.log('xline')
      await clickUnconstrained({
        hoverPos: { x: xLine.x, y: xLine.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained: 'xLine(length = 26.04)',
        expectAfterUnconstrained: 'xLine(length = xRel002)',
        expectFinal: 'xLine(length = 26.04)',
        steps: 10,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="5"]',
      })
    })
    test('for segments [yLine, angledLineOfXLength, angledLineOfYLength]', async ({
      page,
      editor,
      homePage,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
      part001 = startSketchOn(XZ)
        |> startProfile(at = [0, 0])
        |> line(end = [0.5, -14 + 0])
        |> angledLine(angle = 3 + 0, length = 32 + 0)
        |> line(endAbsolute = [33, 11.5 + 0])
        |> xLine(endAbsolute = 9 - 5)
        |> yLine(endAbsolute = -10.77, tag = $a)
        |> xLine(length = 26.04)
        |> yLine(length = 21.14 + 0)
        |> angledLine(angle = 181 + 0, lengthX = 23.14)
        |> angledLine(angle = -91, lengthY = 19 + 0)
        |> angledLine(angle = 3 + 0, endAbsoluteX = 26)
        |> angledLine(angle = 89, endAbsoluteY = 9.14 + 0)
        |> angledLineThatIntersects(angle = 4.14, intersectTag = a, offset = 9)
        |> tangentialArc(endAbsolute = [3.14 + 13, 3.14])
      `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()
      await page.waitForTimeout(500)

      await page.getByText('xLine(endAbsolute = 9 - 5)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page, editor)
      const clickConstrained = _clickConstrained(page, editor)

      let ang = 0

      const yLine = await u.getBoundingBox('[data-overlay-index="6"]')
      ang = await u.getAngle('[data-overlay-index="6"]')
      console.log('yline1')
      await clickConstrained({
        hoverPos: { x: yLine.x, y: yLine.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: 'yLine(length = 21.14 + 0)',
        expectAfterUnconstrained: 'yLine(length = 21.14)',
        expectFinal: 'yLine(length = yRel001)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="6"]',
      })

      const angledLineOfXLength = await u.getBoundingBox(
        '[data-overlay-index="7"]'
      )
      ang = await u.getAngle('[data-overlay-index="7"]')
      console.log('angledLineOfXLength1')
      await clickConstrained({
        hoverPos: { x: angledLineOfXLength.x, y: angledLineOfXLength.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLine(angle = 181 + 0, lengthX = 23.14)',
        expectAfterUnconstrained: 'angledLine(angle = -179, lengthX = 23.14)',
        expectFinal: 'angledLine(angle = angle001, lengthX = 23.14)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })
      console.log('angledLineOfXLength2')
      await clickUnconstrained({
        hoverPos: { x: angledLineOfXLength.x, y: angledLineOfXLength.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained:
          'angledLine(angle = angle001, lengthX = 23.14)',
        expectAfterUnconstrained:
          'angledLine(angle = angle001, lengthX = xRel001)',
        expectFinal: 'angledLine(angle = angle001, lengthX = 23.14)',
        steps: 7,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })

      const angledLineOfYLength = await u.getBoundingBox(
        '[data-overlay-index="8"]'
      )
      ang = await u.getAngle('[data-overlay-index="8"]')
      console.log('angledLineOfYLength1')
      await clickUnconstrained({
        hoverPos: { x: angledLineOfYLength.x, y: angledLineOfYLength.y },
        constraintType: 'angle',
        expectBeforeUnconstrained: 'angledLine(angle = -91, lengthY = 19 + 0)',
        expectAfterUnconstrained:
          'angledLine(angle = angle002, lengthY = 19 + 0)',
        expectFinal: 'angledLine(angle = -91, lengthY = 19 + 0)',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="8"]',
      })
      console.log('angledLineOfYLength2')
      await clickConstrained({
        hoverPos: { x: angledLineOfYLength.x, y: angledLineOfYLength.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: 'angledLine(angle = -91, lengthY = 19 + 0)',
        expectAfterUnconstrained: 'angledLine(angle = -91, lengthY = 19)',
        expectFinal: 'angledLine(angle = -91, lengthY = yRel002)',
        ang: ang + 180,
        steps: 7,
        locator: '[data-overlay-toolbar-index="8"]',
      })
    })
    test('for segments [angledLineToX, angledLineToY, angledLineThatIntersects]', async ({
      page,
      editor,
      homePage,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
      part001 = startSketchOn(XZ)
        |> startProfile(at = [0, 0])
        |> line(end = [0.5, -14 + 0])
        |> angledLine(angle = 3 + 0, length = 32 + 0)
        |> line(endAbsolute = [33, 11.5 + 0])
        |> xLine(endAbsolute = 9 - 5)
        |> yLine(endAbsolute = -10.77, tag = $a)
        |> xLine(length = 26.04)
        |> yLine(length = 21.14 + 0)
        |> angledLine(angle = 181 + 0, lengthX = 23.14)
        |> angledLine(angle = -91, lengthY = 19 + 0)
        |> angledLine(angle = 3 + 0, endAbsoluteX = 26)
        |> angledLine(angle = 89, endAbsoluteY = 9.14 + 0)
        |> angledLineThatIntersects(angle = 4.14, intersectTag = a, offset = 9)
        |> tangentialArc(endAbsolute = [3.14 + 13, 1.14])
      `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLine(endAbsolute = 9 - 5)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page, editor)
      const clickConstrained = _clickConstrained(page, editor)

      let ang = 0

      const angledLineToX = await u.getBoundingBox('[data-overlay-index="9"]')
      ang = await u.getAngle('[data-overlay-index="9"]')
      console.log('angledLineToX')
      await clickConstrained({
        hoverPos: { x: angledLineToX.x, y: angledLineToX.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLine(angle = 3 + 0, endAbsoluteX = 26)',
        expectAfterUnconstrained: 'angledLine(angle = 3, endAbsoluteX = 26)',
        expectFinal: 'angledLine(angle = angle001, endAbsoluteX = 26)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })
      console.log('angledLineToX2')
      await clickUnconstrained({
        hoverPos: { x: angledLineToX.x, y: angledLineToX.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained:
          'angledLine(angle = angle001, endAbsoluteX = 26)',
        expectAfterUnconstrained:
          'angledLine(angle = angle001, endAbsoluteX = xAbs001)',
        expectFinal: 'angledLine(angle = angle001, endAbsoluteX = 26)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })

      const angledLineToY = await u.getBoundingBox('[data-overlay-index="10"]')
      ang = await u.getAngle('[data-overlay-index="10"]')
      console.log('angledLineToY')
      await clickUnconstrained({
        hoverPos: { x: angledLineToY.x, y: angledLineToY.y },
        constraintType: 'angle',
        expectBeforeUnconstrained: 'angledLine(angle = 89, to = 9.14 + 0)',
        expectAfterUnconstrained: 'angledLine(angle = angle002, to = 9.14 + 0)',
        expectFinal: 'angledLine(angle = 89, to = 9.14 + 0)',
        steps: process.platform === 'darwin' ? 8 : 9,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })
      console.log('angledLineToY2')
      await clickConstrained({
        hoverPos: { x: angledLineToY.x, y: angledLineToY.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained:
          'angledLine(angle = 89, endAbsoluteY = 9.14 + 0)',
        expectAfterUnconstrained: 'angledLine(angle = 89, endAbsoluteY = 9.14)',
        expectFinal: 'angledLine(angle = 89, endAbsoluteY = yAbs001)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })

      const angledLineThatIntersects = await u.getBoundingBox(
        '[data-overlay-index="11"]'
      )
      ang = await u.getAngle('[data-overlay-index="11"]')
      console.log('angledLineThatIntersects')
      await clickUnconstrained({
        hoverPos: {
          x: angledLineThatIntersects.x,
          y: angledLineThatIntersects.y,
        },
        constraintType: 'angle',
        expectBeforeUnconstrained: `angledLineThatIntersects(angle = 4.14, intersectTag = a, offset = 9)`,
        expectAfterUnconstrained: `angledLineThatIntersects(angle = angle003, intersectTag = a,offset = 9)`,
        expectFinal: `angledLineThatIntersects(angle = -176, offset = 9, intersectTag = a)`,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="11"]',
      })
      console.log('angledLineThatIntersects2')
      await clickUnconstrained({
        hoverPos: {
          x: angledLineThatIntersects.x,
          y: angledLineThatIntersects.y,
        },
        constraintType: 'intersectionOffset',
        expectBeforeUnconstrained: `angledLineThatIntersects(angle = -176, offset = 9, intersectTag = a)`,
        expectAfterUnconstrained: `angledLineThatIntersects(angle = -176, offset = perpDist001, intersectTag = a)`,
        expectFinal: `angledLineThatIntersects(angle = -176, offset = 9, intersectTag = a)`,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="11"]',
      })
    })
    test('for segment [tangentialArc]', async ({
      page,
      editor,
      homePage,
      scene,
      cmdBar,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
      part001 = startSketchOn(XZ)
        |> startProfile(at = [0, 0])
        |> line(end = [0.5, -14 + 0])
        |> angledLine(angle = 3 + 0, length = 32 + 0)
        |> line(endAbsolute = [33, 11.5 + 0])
        |> xLine(endAbsolute = 9 - 5)
        |> yLine(endAbsolute = -10.77, tag = $a)
        |> xLine(length = 26.04)
        |> yLine(length = 21.14 + 0)
        |> angledLine(angle = 181 + 0, lengthX = 23.14)
        |> angledLine(angle = -91, lengthY = 19 + 0)
        |> angledLine(angle = 3 + 0, endAbsoluteX = 26)
        |> angledLine(angle = 89, endAbsoluteY = 9.14 + 0)
        |> angledLineThatIntersects(angle = 4.14, intersectTag = a, offset = 9)
        |> tangentialArc(endAbsolute = [3.14 + 13, -3.14])
      `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLine(endAbsolute = 9 - 5)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(14)

      const clickUnconstrained = _clickUnconstrained(page, editor)
      const clickConstrained = _clickConstrained(page, editor)

      const tangentialArc = await u.getBoundingBox('[data-overlay-index="13"]')
      let ang = await u.getAngle('[data-overlay-index="13"]')
      console.log('tangentialArc')
      await clickConstrained({
        hoverPos: { x: tangentialArc.x, y: tangentialArc.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained:
          'tangentialArc(endAbsolute = [3.14 + 13, -3.14])',
        expectAfterUnconstrained: 'tangentialArc(endAbsolute = [16.14, -3.14])',
        expectFinal: 'tangentialArc(endAbsolute = [xAbs001, -3.14])',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="13"]',
      })
      console.log('tangentialArc2')
      await clickUnconstrained({
        hoverPos: { x: tangentialArc.x, y: tangentialArc.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained:
          'tangentialArc(endAbsolute = [xAbs001, -3.14])',
        expectAfterUnconstrained:
          'tangentialArc(endAbsolute = [xAbs001, yAbs001])',
        expectFinal: 'tangentialArc(endAbsolute = [xAbs001, -3.14])',
        ang: ang + 180,
        steps: 10,
        locator: '[data-overlay-toolbar-index="13"]',
      })
    })
    test('for segment [arcTo]', async ({
      page,
      editor,
      homePage,
      scene,
      cmdBar,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [56.37, 120.33])
  |> line(end = [162.86, 106.48])
  |> arc(
       interiorAbsolute = [360.16, 231.76],
       endAbsolute = [391.48, 131.54],
     )
  |> yLine(length = -131.54)
  |> arc(angleStart = 33.53, angleEnd = -141.07, radius = 126.46)
`
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.connectionEstablished()
      await scene.settled(cmdBar)

      // wait for execution done

      await page.getByText('line(end = [162.86, 106.48])').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(5)

      const clickUnconstrained = _clickUnconstrained(page, editor)
      const clickConstrained = _clickConstrained(page, editor)

      const arcTo = await u.getBoundingBox('[data-overlay-index="1"]')
      let ang = await u.getAngle('[data-overlay-index="1"]')
      console.log('arcTo interiorAbsolute x')
      await clickUnconstrained({
        hoverPos: { x: arcTo.x, y: arcTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: `arc(interiorAbsolute = [360.16, 231.76], endAbsolute = [391.48, 131.54])`,
        expectAfterUnconstrained: `arc(interiorAbsolute = [360.16, 231.76], endAbsolute = [391.48, 131.54])`,
        expectFinal: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [391.48, 131.54])`,
        ang: ang,
        steps: 6,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      console.log('arcTo interiorAbsolute y')
      await clickUnconstrained({
        hoverPos: { x: arcTo.x, y: arcTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [391.48, 131.54])`,
        expectAfterUnconstrained: `arc(interiorAbsolute = [xAbs001, yAbs001], endAbsolute = [391.48, 131.54])`,
        expectFinal: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [391.48, 131.54])`,
        ang: ang,
        steps: 10,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      console.log('arcTo end x')
      await clickConstrained({
        hoverPos: { x: arcTo.x, y: arcTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [391.48, 131.54])`,
        expectAfterUnconstrained: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [391.48, 131.54])`,
        expectFinal: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [xAbs002, 131.54])`,
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      console.log('arcTo end y')
      await clickUnconstrained({
        hoverPos: { x: arcTo.x, y: arcTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [xAbs002, 131.54])`,
        expectAfterUnconstrained: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [xAbs002, yAbs002])`,
        expectFinal: `arc(interiorAbsolute = [xAbs001, 231.76], endAbsolute = [xAbs002, 131.54])`,
        ang: ang + 180,
        steps: 10,
        locator: '[data-overlay-toolbar-index="1"]',
      })
    })
    test('for segment [circle]', async ({ page, editor, homePage }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
part001 = startSketchOn(XZ)
      |> circle(center = [1 + 0, 0], radius = 8)
    `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('circle(center = [1 + 0, 0], radius = 8)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(1)

      const clickUnconstrained = _clickUnconstrained(page, editor)
      const clickConstrained = _clickConstrained(page, editor)

      const hoverPos = { x: 789, y: 114 } as const
      let ang = await u.getAngle('[data-overlay-index="0"]')
      console.log('angl', ang)
      console.log('circle center x')
      await clickConstrained({
        hoverPos,
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'circle(center = [1 + 0, 0], radius = 8)',
        expectAfterUnconstrained: 'circle(center = [1, 0], radius = 8)',
        expectFinal: 'circle(center = [xAbs001, 0], radius = 8)',
        ang: ang + 105,
        steps: 6,
        locator: '[data-overlay-toolbar-index="0"]',
      })
      console.log('circle center y')
      await clickUnconstrained({
        hoverPos,
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'circle(center = [xAbs001, 0], radius = 8)',
        expectAfterUnconstrained:
          'circle(center = [xAbs001, yAbs001], radius =  8)',
        expectFinal: 'circle(center = [xAbs001, 0], radius =  8)',
        ang: ang + 180,
        steps: 30,
        locator: '[data-overlay-toolbar-index="0"]',
      })
      console.log('circle radius')
      await clickUnconstrained({
        hoverPos,
        constraintType: 'radius',
        expectBeforeUnconstrained: 'circle(center = [xAbs001, 0], radius = 8)',
        expectAfterUnconstrained:
          'circle(center = [xAbs001, 0], radius = radius001)',
        expectFinal: 'circle(center = [xAbs001, 0], radius = 8)',
        ang: ang + 105,
        steps: 10,
        locator: '[data-overlay-toolbar-index="0"]',
      })
    })
  })
  test.describe('Testing deleting a segment', () => {
    const _deleteSegmentSequence =
      (page: Page, editor: EditorFixture) =>
      async ({
        hoverPos,
        codeToBeDeleted,
        stdLibFnName,
        ang = 45,
        steps = 6,
        locator,
      }: {
        hoverPos: { x: number; y: number }
        codeToBeDeleted: string
        stdLibFnName: string
        ang?: number
        steps?: number
        locator?: string
      }) => {
        await expect(page.getByText('Added variable')).not.toBeVisible()

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)
        await page.mouse.move(x, y)

        await editor.expectEditor.toContain(codeToBeDeleted, {
          shouldNormalise: true,
        })

        await page
          .locator(`[data-stdlib-fn-name="${stdLibFnName}"]`)
          .first()
          .click()
        await page.getByText('Delete Segment').click()

        await editor.expectEditor.not.toContain(codeToBeDeleted, {
          shouldNormalise: true,
        })
      }
    test('all segment types', async ({
      page,
      editor,
      homePage,
      scene,
      cmdBar,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)
part001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0.5, -14 + 0])
  |> angledLine(angle = 3 + 0, length = 32 + 0)
  |> line(endAbsolute = [33, 11.5 + 0])
  |> xLine(endAbsolute = 9 - 5)
  |> yLine(endAbsolute = -10.77, tag = $a)
  |> xLine(length = 26.04)
  |> yLine(length = 21.14 + 0)
  |> angledLine(angle = 181 + 0, lengthX = 23.14)
  |> angledLine(angle = -91, lengthY = 19 + 0)
  |> angledLine(angle = 3 + 0, endAbsoluteX = 26)
  |> angledLine(angle = 89, endAbsoluteY = 9.14 + 0)
  |> angledLineThatIntersects(angle = 4.14, intersectTag = a, offset = 9)
  |> tangentialArc(endAbsolute = [3.14 + 13, 1.14])
  |> arc(interiorAbsolute = [16.25, 5.12], endAbsolute = [21.61, 4.15])
  |> arc(angleStart = 40.27, angleEnd = -38.05, radius = 9.03)

      `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.connectionEstablished()
      await scene.settled(cmdBar)
      await u.waitForPageLoad()

      await page.getByText('xLine(endAbsolute = 9 - 5)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(17)
      const deleteSegmentSequence = _deleteSegmentSequence(page, editor)

      let segmentToDelete
      let ang = 0

      const getOverlayByIndex = (index: number) =>
        u.getBoundingBox(`[data-overlay-index="${index}"]`)

      let overlayIndex = 15

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: `arc(angleStart = 40.27, angleEnd = -38.05, radius = 9.03)`,
        stdLibFnName: 'arc',
        ang: ang + 180,
        steps: 6,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: `arc(interiorAbsolute = [16.25, 5.12], endAbsolute = [21.61, 4.15])`,
        stdLibFnName: 'arc',
        ang: ang,
        steps: 6,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'tangentialArc(endAbsolute = [3.14 + 13, 1.14])',
        stdLibFnName: 'tangentialArc',
        ang: ang + 180,
        steps: 6,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: `angledLineThatIntersects(angle = 4.14, intersectTag = a, offset = 9)`,
        stdLibFnName: 'angledLineThatIntersects',
        ang: ang + 180,
        steps: 7,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLine(angle = 89, endAbsoluteY = 9.14 + 0)',
        stdLibFnName: 'angledLineToY',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLine(angle = 3 + 0, endAbsoluteX = 26)',
        stdLibFnName: 'angledLineToX',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLine(angle = -91, lengthY = 19 + 0)',
        stdLibFnName: 'angledLineOfYLength',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLine(angle = 181 + 0, lengthX = 23.14)',
        stdLibFnName: 'angledLineOfXLength',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'yLine(length = 21.14 + 0)',
        stdLibFnName: 'yLine',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'xLine(length = 26.04)',
        stdLibFnName: 'xLine',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'yLine(endAbsolute = -10.77, tag = $a)',
        stdLibFnName: 'yLineTo',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'xLine(endAbsolute = 9 - 5)',
        stdLibFnName: 'xLineTo',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await expect(page.getByText('Added variable')).not.toBeVisible()

      const hoverPos = { x: segmentToDelete.x, y: segmentToDelete.y }
      await page.mouse.move(0, 0)
      await page.waitForTimeout(1000)
      await page.mouse.move(hoverPos.x, hoverPos.y)
      await wiggleMove(
        page,
        hoverPos.x,
        hoverPos.y,
        20,
        30,
        ang,
        10,
        5,
        `[data-overlay-toolbar-index="${overlayIndex}"]`
      )
      await page.mouse.move(hoverPos.x, hoverPos.y)

      const codeToBeDeleted = 'line(endAbsolute = [33, 11.5 + 0])'
      await editor.expectEditor.toContain(codeToBeDeleted, {
        shouldNormalise: true,
      })

      await page.getByTestId('overlay-menu').click()
      await page.getByText('Delete Segment').click()

      await editor.expectEditor.not.toContain(codeToBeDeleted, {
        shouldNormalise: true,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLine(angle = 3 + 0, length = 32 + 0)',
        stdLibFnName: 'angledLine',
        ang: ang + 180,
        locator: `[data-overlay-toolbar-index="${overlayIndex}"]`,
      })

      overlayIndex--

      segmentToDelete = await getOverlayByIndex(overlayIndex)
      ang = await u.getAngle(`[data-overlay-index="${overlayIndex}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'line(end = [0.5, -14 + 0])',
        stdLibFnName: 'line',
        ang: ang + 180,
      })

      await page.waitForTimeout(200)
    })
  })
  test.describe('Testing delete with dependent segments', () => {
    const cases = [
      'line(end = [22, 2], tag = $seg01)',
      'angledLine(angle = 5, length = 23.03, tag = $seg01)',
      'xLine(length = 23, tag = $seg01)',
      'yLine(length = -8, tag = $seg01)',
      'xLine(endAbsolute = 30, tag = $seg01)',
      'yLine(endAbsolute = -4, tag = $seg01)',
      'angledLine(angle = 3, lengthX = 30, tag = $seg01)',
      'angledLine(angle = 3, lengthY = 1.5, tag = $seg01)',
      'angledLine(angle = 3, endAbsoluteX = 30, tag = $seg01)',
      'angledLine(angle = 3, endAbsoluteY = 7, tag = $seg01)',
    ]
    for (const doesHaveTagOutsideSketch of [true, false]) {
      for (const lineOfInterest of cases) {
        const isObj = lineOfInterest.includes('{ angle = 3,')
        test(`${lineOfInterest}${isObj ? '-[obj-input]' : ''}${
          doesHaveTagOutsideSketch ? '-[tagOutsideSketch]' : ''
        }`, async ({ page, editor, homePage }) => {
          await page.addInitScript(
            async ({ lineToBeDeleted, extraLine }) => {
              localStorage.setItem(
                'persistCode',
                `@settings(defaultLengthUnit = in)
        part001 = startSketchOn(XZ)
          |> startProfile(at = [5, 6])
          |> ${lineToBeDeleted}
          |> line(end = [-10, -15])
          |> angledLine(angle = -176, length = segLen(seg01))
        ${extraLine ? 'myVar = segLen(seg01)' : ''}`
              )
            },
            {
              lineToBeDeleted: lineOfInterest,
              extraLine: doesHaveTagOutsideSketch,
            }
          )
          const u = await getUtils(page)
          await page.setBodyDimensions({ width: 1200, height: 500 })

          await homePage.goToModelingScene()
          await u.waitForPageLoad()
          await page.waitForTimeout(1000)

          await expect
            .poll(async () => {
              await editor.scrollToText(lineOfInterest)
              await page.waitForTimeout(1000)
              await page.keyboard.press('ArrowRight')
              await page.waitForTimeout(500)
              await page.keyboard.press('ArrowLeft')
              await page.waitForTimeout(500)
              try {
                await expect(
                  page.getByRole('button', { name: 'Edit Sketch' })
                ).toBeVisible()
                return true
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
              } catch (_e) {
                return false
              }
            })
            .toBe(true)
          await page.getByRole('button', { name: 'Edit Sketch' }).click()

          await expect(page.getByTestId('segment-overlay')).toHaveCount(3)
          const segmentToDelete = await u.getBoundingBox(
            `[data-overlay-index="0"]`
          )

          const isYLine = lineOfInterest.toLowerCase().includes('yline')
          const hoverPos = {
            x: segmentToDelete.x + (isYLine ? 0 : -20),
            y: segmentToDelete.y + (isYLine ? -20 : 0),
          }
          await expect(page.getByText('Added variable')).not.toBeVisible()
          const ang = isYLine ? 45 : -45
          const [x, y] = [
            Math.cos((ang * Math.PI) / 180) * 45,
            Math.sin((ang * Math.PI) / 180) * 45,
          ]

          await page.mouse.move(hoverPos.x + x, hoverPos.y + y)
          await page.mouse.move(hoverPos.x, hoverPos.y, { steps: 5 })

          await editor.expectEditor.toContain(lineOfInterest, {
            shouldNormalise: true,
          })

          await page.getByTestId('overlay-menu').click()
          await page.waitForTimeout(100)
          await page.getByText('Delete Segment').click()

          await page.getByText('Cancel').click()

          await page.mouse.move(hoverPos.x + x, hoverPos.y + y)
          await page.mouse.move(hoverPos.x, hoverPos.y, { steps: 5 })

          await editor.expectEditor.toContain(lineOfInterest, {
            shouldNormalise: true,
          })

          await page.getByTestId('overlay-menu').click()
          await page.waitForTimeout(100)
          await page.getByText('Delete Segment').click()

          await page.getByText('Continue and unconstrain').last().click()

          if (doesHaveTagOutsideSketch) {
            // eslint-disable-next-line jest/no-conditional-expect
            await expect(
              page.getByText(
                'Segment tag used outside of current Sketch. Could not delete.'
              )
            ).toBeTruthy()
            // eslint-disable-next-line jest/no-conditional-expect
            await editor.expectEditor.toContain(lineOfInterest, {
              shouldNormalise: true,
            })
          } else {
            // eslint-disable-next-line jest/no-conditional-expect
            await editor.expectEditor.not.toContain(lineOfInterest, {
              shouldNormalise: true,
            })
            // eslint-disable-next-line jest/no-conditional-expect
            await editor.expectEditor.not.toContain('seg01', {
              shouldNormalise: true,
            })
          }
        })
      }
    }
  })
  test.describe('Testing remove constraints segments', () => {
    const cases = [
      {
        before: `line(end = [22 + 0, 2 + 0], tag = $seg01)`,
        after: `line(end = [22, 2], tag = $seg01)`,
      },

      {
        before: `angledLine(angle = 5 + 0, length = 23.03 + 0, tag = $seg01)`,
        after: `line(end = [22.94, 2.01], tag = $seg01)`,
      },
      {
        before: `xLine(length = 23 + 0, tag = $seg01)`,
        after: `line(end = [23, 0], tag = $seg01)`,
      },
      {
        before: `yLine(length = -8 + 0, tag = $seg01)`,
        after: `line(end = [0, -8], tag = $seg01)`,
      },
      {
        before: `xLine(endAbsolute = 30 + 0, tag = $seg01)`,
        after: `line(end = [25, 0], tag = $seg01)`,
      },
      {
        before: `yLine(endAbsolute = -4 + 0, tag = $seg01)`,
        after: `line(end = [0, -10], tag = $seg01)`,
      },
      {
        before: `angledLine(angle = 3 + 0, lengthX = 30 + 0, tag = $seg01)`,
        after: `line(end = [30, 1.57], tag = $seg01)`,
      },
      {
        before: `angledLine(angle = 3 + 0, lengthY = 1.5 + 0, tag = $seg01)`,
        after: `line(end = [28.62, 1.5], tag = $seg01)`,
      },
      {
        before: `angledLine(angle = 3 + 0, endAbsoluteX = 30 + 0, tag = $seg01)`,
        after: `line(end = [25, 1.31], tag = $seg01)`,
      },
      {
        before: `angledLine(angle = 3 + 0, endAbsoluteY = 7 + 0, tag = $seg01)`,
        after: `line(end = [19.08, 1], tag = $seg01)`,
      },
    ]

    for (const { before, after } of cases) {
      test(before, async ({ page, editor, homePage, scene, cmdBar }) => {
        await page.addInitScript(
          async ({ lineToBeDeleted }) => {
            localStorage.setItem(
              'persistCode',
              `@settings(defaultLengthUnit = in)
      part001 = startSketchOn(XZ)
        |> startProfile(at = [5, 6])
        |> ${lineToBeDeleted}
        |> line(end = [-10, -15])
        |> angledLine(angle = -176, length = segLen(seg01))`
            )
          },
          {
            lineToBeDeleted: before,
          }
        )
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 500 })

        await homePage.goToModelingScene()
        await scene.connectionEstablished()
        await scene.settled(cmdBar)
        await page.waitForTimeout(300)

        await page.getByText(before).click()
        await page.waitForTimeout(100)
        await page.getByRole('button', { name: 'Edit Sketch' }).click()
        await page.waitForTimeout(500)

        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
        await expect(page.getByText('Added variable')).not.toBeVisible()

        const hoverPos = await u.getBoundingBox(`[data-overlay-index="1"]`)
        let ang = await u.getAngle('[data-overlay-index="1"]')
        ang += 180

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        let x = 0,
          y = 0
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(
          page,
          x,
          y,
          20,
          30,
          ang,
          10,
          5,
          '[data-overlay-toolbar-index="1"]'
        )
        await page.mouse.move(x, y)

        await editor.expectEditor.toContain(before, { shouldNormalise: true })

        await page.getByTestId('overlay-menu').click()
        await page.waitForTimeout(100)
        await page.getByRole('button', { name: 'Remove constraints' }).click()

        await editor.expectEditor.toContain(after, { shouldNormalise: true })

        // check the cursor was left in the correct place after transform
        await expect(page.locator('.cm-activeLine')).toHaveText('|> ' + after)
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Testing with showAllOverlays flag', () => {
    test('circle overlay constraints with showAllOverlays', async ({
      page,
      editor,
      homePage,
      scene,
      cmdBar,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `myvar = -141
sketch001 = startSketchOn(XZ)
profile002 = circle(sketch001, center = [345, 0], radius = 238.38)
`
        )
        // Set flag to always show overlays without hover
        localStorage.setItem('showAllOverlays', 'true')
      })

      await page.setBodyDimensions({ width: 1200, height: 500 })

      await homePage.goToModelingScene()
      await scene.connectionEstablished()
      await scene.settled(cmdBar)

      // Click on the circle line to enter edit mode
      await page
        .getByText('circle(sketch001, center = [345, 0], radius = 238.38)')
        .click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      // Verify that the overlay is visible without hovering
      await expect(page.getByTestId('segment-overlay')).toHaveCount(1)

      // First, constrain the X coordinate
      const xConstraintBtn = page.locator(
        '[data-constraint-type="xAbsolute"][data-is-constrained="false"]'
      )
      await expect(xConstraintBtn).toBeVisible()
      await xConstraintBtn.click()

      // Complete the command
      await expect(
        page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
      ).toBeFocused()
      await page.getByRole('button', { name: 'arrow right Continue' }).click()

      // Verify the X constraint was added
      await editor.expectEditor.toContain('center = [xAbs001, 0]', {
        shouldNormalise: true,
      })

      // Now constrain the Y coordinate
      const yConstraintBtn = page.locator(
        '[data-constraint-type="yAbsolute"][data-is-constrained="false"]'
      )
      await expect(yConstraintBtn).toBeVisible()
      await yConstraintBtn.click()

      // Complete the command
      await expect(
        page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
      ).toBeFocused()
      await page.getByRole('button', { name: 'arrow right Continue' }).click()

      // Verify the Y constraint was added
      await editor.expectEditor.toContain('center = [xAbs001, yAbs001]', {
        shouldNormalise: true,
      })

      // Now constrain the radius
      const radiusConstraintBtn = page.locator(
        '[data-constraint-type="radius"][data-is-constrained="false"]'
      )
      await expect(radiusConstraintBtn).toBeVisible()
      await radiusConstraintBtn.click()

      // Complete the command
      await expect(
        page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
      ).toBeFocused()
      await page.getByRole('button', { name: 'arrow right Continue' }).click()

      // Verify all constraints were added
      await editor.expectEditor.toContain(
        'center = [xAbs001, yAbs001], radius = radius001',
        { shouldNormalise: true }
      )

      // Now unconstrain the X coordinate
      const constrainedXBtn = page.locator(
        '[data-constraint-type="xAbsolute"][data-is-constrained="true"]'
      )
      await expect(constrainedXBtn).toBeVisible()
      await constrainedXBtn.click()

      // Verify the X constraint was removed
      await editor.expectEditor.toContain(
        'center = [345, yAbs001], radius = radius001',
        { shouldNormalise: true }
      )

      // Now unconstrain the Y coordinate
      const constrainedYBtn = page.locator(
        '[data-constraint-type="yAbsolute"][data-is-constrained="true"]'
      )
      await expect(constrainedYBtn).toBeVisible()
      await constrainedYBtn.click()

      // Verify the Y constraint was removed
      await editor.expectEditor.toContain(
        'center = [345, 0], radius = radius001',
        { shouldNormalise: true }
      )

      // Finally, unconstrain the radius
      const constrainedRadiusBtn = page.locator(
        '[data-constraint-type="radius"][data-is-constrained="true"]'
      )
      await expect(constrainedRadiusBtn).toBeVisible()
      await constrainedRadiusBtn.click()

      // Verify all constraints were removed
      await editor.expectEditor.toContain(
        'center = [345, 0], radius = 238.38',
        { shouldNormalise: true }
      )
    })
  })
  test('startProfile x y overlays', async ({
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
profile001 = startProfile(sketch001, at = [15, 15])
  |> line(end = [114.78, 232])
  |> line(end = [228.75, -208.39])
`
      )
      // Set flag to always show overlays without hover
      localStorage.setItem('showAllOverlays', 'true')
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    await toolbar.waitForFeatureTreeToBeBuilt()
    await toolbar.editSketch(0)
    await page.waitForTimeout(600)
    await expect(page.getByTestId('segment-overlay')).toHaveCount(3)

    // 1. constrain x coordinate
    const xConstraintBtn = page.locator(
      '[data-constraint-type="xAbsolute"][data-is-constrained="false"]'
    )
    await expect(xConstraintBtn).toBeVisible()
    await xConstraintBtn.click()

    await expect(
      page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
    ).toBeFocused()
    await cmdBar.progressCmdBar()

    await editor.expectEditor.toContain('at = [xAbs001, 15]', {
      shouldNormalise: true,
    })

    // 2. constrain y coordinate
    const yConstraintBtn = page.locator(
      '[data-constraint-type="yAbsolute"][data-is-constrained="false"]'
    )
    await expect(yConstraintBtn).toBeVisible()
    await yConstraintBtn.click()

    await expect(
      page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
    ).toBeFocused()
    await cmdBar.progressCmdBar()
    await editor.expectEditor.toContain('at = [xAbs001, yAbs001]', {
      shouldNormalise: true,
    })
    // 3. unconstrain x coordinate
    const constrainedXBtn = page.locator(
      '[data-constraint-type="xAbsolute"][data-is-constrained="true"]'
    )
    await expect(constrainedXBtn).toBeVisible()
    await constrainedXBtn.click()
    await editor.expectEditor.toContain('at = [15, yAbs001]', {
      shouldNormalise: true,
    })
    // 4. unconstrain y coordinate
    const constrainedYBtn = page.locator(
      '[data-constraint-type="yAbsolute"][data-is-constrained="true"]'
    )
    await expect(constrainedYBtn).toBeVisible()
    await constrainedYBtn.click()
    await editor.expectEditor.toContain('at = [15, 15]', {
      shouldNormalise: true,
    })
  })
  test('arc with interiorAbsolute and endAbsolute kwargs overlay constraints', async ({
    page,
    editor,
    homePage,
    scene,
    cmdBar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `myvar = 141
sketch001 = startSketchOn(XZ)
profile001 = circleThreePoint(
  sketch001,
  p1 = [445.16, 202.16],
  p2 = [445.16, 116.92],
  p3 = [546.85, 103],
)
profile003 = startProfile(sketch001, at = [64.39, 35.16])
  |> line(end = [60.69, 23.02])
  |> arc(interiorAbsolute = [159.26, 100.58], endAbsolute = [237.05, 84.07])
  |> line(end = [70.31, 42.28])`
      )
      // Set flag to always show overlays without hover
      localStorage.setItem('showAllOverlays', 'true')
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()
    await scene.connectionEstablished()
    await scene.settled(cmdBar)

    // Click on the line before the arc to enter edit mode
    await page.getByText('line(end = [60.69, 23.02])').click()
    await page.waitForTimeout(100)
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(500)

    // Verify overlays are visible
    // 3 for the three point arc, and 4 for the 3 segments (arc has two)
    await expect(page.getByTestId('segment-overlay')).toHaveCount(8)

    // ---- Testing interior point constraints ----

    // 1. Constrain interior X coordinate
    const interiorXConstraintBtn = page
      .locator(
        '[data-constraint-type="xAbsolute"][data-is-constrained="false"]'
      )
      .nth(4)
    await expect(interiorXConstraintBtn).toBeVisible()
    await interiorXConstraintBtn.click()

    // Complete the command
    await expect(
      page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
    ).toBeFocused()
    await page.getByRole('button', { name: 'arrow right Continue' }).click()

    // Verify the constraint was added
    await editor.expectEditor.toContain(
      'interiorAbsolute = [xAbs001, 100.58]',
      {
        shouldNormalise: true,
      }
    )

    // 2. Constrain interior Y coordinate
    const interiorYConstraintBtn = page
      .locator(
        '[data-constraint-type="yAbsolute"][data-is-constrained="false"]'
      )
      .nth(4)
    await expect(interiorYConstraintBtn).toBeVisible()
    await interiorYConstraintBtn.click()

    // Complete the command
    await expect(
      page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
    ).toBeFocused()
    await page.getByRole('button', { name: 'arrow right Continue' }).click()

    // Verify both constraints were added
    await editor.expectEditor.toContain(
      'interiorAbsolute = [xAbs001, yAbs001]',
      {
        shouldNormalise: true,
      }
    )

    // ---- Testing end point constraints ----

    // 3. Constrain end X coordinate
    const endXConstraintBtn = page
      .locator(
        '[data-constraint-type="xAbsolute"][data-is-constrained="false"]'
      )
      .nth(4) // still number 3 because the interior ones are now constrained
    await expect(endXConstraintBtn).toBeVisible()
    await endXConstraintBtn.click()

    // Complete the command
    await expect(
      page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
    ).toBeFocused()
    await page.getByRole('button', { name: 'arrow right Continue' }).click()

    // Verify the constraint was added
    await editor.expectEditor.toContain('endAbsolute = [xAbs002, 84.07]', {
      shouldNormalise: true,
    })

    // 4. Constrain end Y coordinate
    const endYConstraintBtn = page
      .locator(
        '[data-constraint-type="yAbsolute"][data-is-constrained="false"]'
      )
      .nth(4) // still number 3 because the interior ones are now constrained
    await expect(endYConstraintBtn).toBeVisible()
    await endYConstraintBtn.click()

    // Complete the command
    await expect(
      page.getByTestId('cmd-bar-arg-value').getByRole('textbox')
    ).toBeFocused()
    await page.getByRole('button', { name: 'arrow right Continue' }).click()

    // Verify all constraints were added
    await editor.expectEditor.toContain(
      'interiorAbsolute = [xAbs001, yAbs001], endAbsolute = [xAbs002, yAbs002]',
      {
        shouldNormalise: true,
      }
    )

    // ---- Unconstrain the coordinates in reverse order ----

    // 5. Unconstrain end Y coordinate
    const constrainedEndYBtn = page
      .locator('[data-constraint-type="yAbsolute"][data-is-constrained="true"]')
      .nth(1)
    await expect(constrainedEndYBtn).toBeVisible()
    await constrainedEndYBtn.click()

    // Verify the constraint was removed
    await editor.expectEditor.toContain('endAbsolute = [xAbs002, 84.07]', {
      shouldNormalise: true,
    })

    // 6. Unconstrain end X coordinate
    const constrainedEndXBtn = page
      .locator('[data-constraint-type="xAbsolute"][data-is-constrained="true"]')
      .nth(1)
    await expect(constrainedEndXBtn).toBeVisible()
    await constrainedEndXBtn.click()

    // Verify the constraint was removed
    await editor.expectEditor.toContain('endAbsolute = [237.05, 84.07]', {
      shouldNormalise: true,
    })

    // 7. Unconstrain interior Y coordinate
    const constrainedInteriorYBtn = page
      .locator('[data-constraint-type="yAbsolute"][data-is-constrained="true"]')
      .nth(0)
    await expect(constrainedInteriorYBtn).toBeVisible()
    await constrainedInteriorYBtn.click()

    // Verify the constraint was removed
    await editor.expectEditor.toContain(
      'interiorAbsolute = [xAbs001, 100.58]',
      {
        shouldNormalise: true,
      }
    )

    // 8. Unconstrain interior X coordinate
    const constrainedInteriorXBtn = page
      .locator('[data-constraint-type="xAbsolute"][data-is-constrained="true"]')
      .nth(0)
    await expect(constrainedInteriorXBtn).toBeVisible()
    await constrainedInteriorXBtn.click()

    // Verify all constraints were removed
    await editor.expectEditor.toContain(
      'interiorAbsolute = [159.26, 100.58], endAbsolute = [237.05, 84.07]',
      {
        shouldNormalise: true,
      }
    )
  })
})
