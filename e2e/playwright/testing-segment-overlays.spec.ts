import { test, expect, Page } from '@playwright/test'

import { deg, getUtils, setup, tearDown, wiggleMove } from './test-utils'
import { LineInputsType } from 'lang/std/sketchcombos'
import { uuidv4 } from 'lib/utils'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Testing segment overlays', () => {
  test.describe('Hover over a segment should show its overlay, hovering over the input overlays should show its popover, clicking the input overlay should constrain/unconstrain it:\nfor the following segments', () => {
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
      (page: Page) =>
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

        await expect(page.locator('.cm-content')).toContainText(
          expectBeforeUnconstrained
        )
        const constrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="true"]`
        )
        await expect(constrainedLocator).toBeVisible()
        await constrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await constrainedLocator.click()
        await expect(page.locator('.cm-content')).toContainText(
          expectAfterUnconstrained
        )

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)

        const unconstrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="false"]`
        )
        await expect(unconstrainedLocator).toBeVisible()
        await unconstrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await unconstrainedLocator.click()
        await page.getByText('Add variable').click()
        await expect(page.locator('.cm-content')).toContainText(expectFinal)
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
      (page: Page) =>
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

        await expect(page.getByText('Added variable')).not.toBeVisible()
        await expect(page.locator('.cm-content')).toContainText(
          expectBeforeUnconstrained
        )
        const unconstrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="false"]`
        )
        await expect(unconstrainedLocator).toBeVisible()
        await unconstrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await unconstrainedLocator.click()
        await page.getByText('Add variable').click()
        await expect(page.locator('.cm-content')).toContainText(
          expectAfterUnconstrained
        )
        await expect(page.getByText('Added variable')).not.toBeVisible()

        await page.mouse.move(0, 0)
        await page.waitForTimeout(1000)
        x = hoverPos.x + Math.cos(ang * deg) * 32
        y = hoverPos.y - Math.sin(ang * deg) * 32
        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)

        const constrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="true"]`
        )
        await expect(constrainedLocator).toBeVisible()
        await constrainedLocator.hover()
        await expect(
          await page.getByTestId('constraint-symbol-popover').count()
        ).toBeGreaterThan(0)
        await constrainedLocator.click()
        await expect(page.locator('.cm-content')).toContainText(expectFinal)
      }
    test.setTimeout(120000)
    test('for segments [line, angledLine, lineTo, xLineTo]', async ({
      page,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([5 + 0, 20 + 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([5 + 33, 20 + 11.5 + 0], %)
    |> xLineTo(5 + 9 - 5, %)
    |> yLineTo(20 + -10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 5 + 26 }, %)
    |> angledLineToY({ angle: 89, to: 20 + 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([5 + 3.14 + 13, 20 + 3.14], %)
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

      await page.getByText('xLineTo(5 + 9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

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

      const line = await u.getBoundingBox(`[data-overlay-index="${0}"]`)
      ang = await u.getAngle(`[data-overlay-index="${0}"]`)
      console.log('line1', line, ang)
      await clickConstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: '|> line([0.5, -14 + 0], %)',
        expectAfterUnconstrained: '|> line([0.5, -14], %)',
        expectFinal: '|> line([0.5, yRel001], %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="0"]',
      })
      console.log('line2')
      await clickUnconstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained: '|> line([0.5, yRel001], %)',
        expectAfterUnconstrained: 'line([xRel001, yRel001], %)',
        expectFinal: '|> line([0.5, yRel001], %)',
        ang: ang + 180,
        locator: '[data-overlay-index="0"]',
      })

      const angledLine = await u.getBoundingBox(`[data-overlay-index="1"]`)
      ang = await u.getAngle(`[data-overlay-index="1"]`)
      console.log('angledLine1')
      await clickConstrained({
        hoverPos: { x: angledLine.x, y: angledLine.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLine({ angle: 3 + 0, length: 32 + 0 }, %)',
        expectAfterUnconstrained: 'angledLine({ angle: 3, length: 32 + 0 }, %)',
        expectFinal: 'angledLine({ angle: angle001, length: 32 + 0 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })
      console.log('angledLine2')
      await clickConstrained({
        hoverPos: { x: angledLine.x, y: angledLine.y },
        constraintType: 'length',
        expectBeforeUnconstrained:
          'angledLine({ angle: angle001, length: 32 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLine({ angle: angle001, length: 32 }, %)',
        expectFinal: 'angledLine({ angle: angle001, length: len001 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      await page.mouse.move(700, 250)
      await page.waitForTimeout(100)

      let lineTo = await u.getBoundingBox(`[data-overlay-index="2"]`)
      ang = await u.getAngle(`[data-overlay-index="2"]`)
      console.log('lineTo1')
      await clickConstrained({
        hoverPos: { x: lineTo.x, y: lineTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'lineTo([5 + 33, 20 + 11.5 + 0], %)',
        expectAfterUnconstrained: 'lineTo([5 + 33, 31.5], %)',
        expectFinal: 'lineTo([5 + 33, yAbs001], %)',
        steps: 8,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="2"]',
      })
      console.log('lineTo2')
      await clickConstrained({
        hoverPos: { x: lineTo.x, y: lineTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'lineTo([5 + 33, yAbs001], %)',
        expectAfterUnconstrained: 'lineTo([38, yAbs001], %)',
        expectFinal: 'lineTo([xAbs001, yAbs001], %)',
        steps: 8,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="2"]',
      })

      const xLineTo = await u.getBoundingBox(`[data-overlay-index="3"]`)
      ang = await u.getAngle(`[data-overlay-index="3"]`)
      console.log('xlineTo1')
      await clickConstrained({
        hoverPos: { x: xLineTo.x, y: xLineTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'xLineTo(5 + 9 - 5, %)',
        expectAfterUnconstrained: 'xLineTo(9, %)',
        expectFinal: 'xLineTo(xAbs002, %)',
        ang: ang + 180,
        steps: 8,
        locator: '[data-overlay-toolbar-index="3"]',
      })
    })
    test('for segments [yLineTo, xLine]', async ({ page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const yRel001 = -14
const xRel001 = 0.5
const angle001 = 3
const len001 = 32
const yAbs001 = 11.5
const xAbs001 = 33
const xAbs002 = 4
const part001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([0.5, yRel001], %)
  |> angledLine({ angle: angle001, length: len001 }, %)
  |> lineTo([33, yAbs001], %)
  |> xLineTo(xAbs002, %)
  |> yLineTo(-10.77, %, $a)
  |> xLine(26.04, %)
  |> yLine(21.14 + 0, %)
  |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
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

      await page.getByText('xLine(26.04, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(8)

      const clickUnconstrained = _clickUnconstrained(page)

      await page.mouse.move(700, 250)
      await page.waitForTimeout(100)

      let ang = 0

      const yLineTo = await u.getBoundingBox(`[data-overlay-index="4"]`)
      ang = await u.getAngle(`[data-overlay-index="4"]`)
      console.log('ylineTo1')
      await clickUnconstrained({
        hoverPos: { x: yLineTo.x, y: yLineTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'yLineTo(-10.77, %, $a)',
        expectAfterUnconstrained: 'yLineTo(yAbs002, %, $a)',
        expectFinal: 'yLineTo(-10.77, %, $a)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="4"]',
      })

      const xLine = await u.getBoundingBox(`[data-overlay-index="5"]`)
      ang = await u.getAngle(`[data-overlay-index="5"]`)
      console.log('xline')
      await clickUnconstrained({
        hoverPos: { x: xLine.x, y: xLine.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained: 'xLine(26.04, %)',
        expectAfterUnconstrained: 'xLine(xRel002, %)',
        expectFinal: 'xLine(26.04, %)',
        steps: 10,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="5"]',
      })
    })
    test('for segments [yLine, angledLineOfXLength, angledLineOfYLength]', async ({
      page,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([0, 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([33, 11.5 + 0], %)
    |> xLineTo(9 - 5, %)
    |> yLineTo(-10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
    |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([3.14 + 13, 3.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()
      await page.waitForTimeout(500)

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      let ang = 0

      const yLine = await u.getBoundingBox(`[data-overlay-index="6"]`)
      ang = await u.getAngle(`[data-overlay-index="6"]`)
      console.log('yline1')
      await clickConstrained({
        hoverPos: { x: yLine.x, y: yLine.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: 'yLine(21.14 + 0, %)',
        expectAfterUnconstrained: 'yLine(21.14, %)',
        expectFinal: 'yLine(yRel001, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="6"]',
      })

      const angledLineOfXLength = await u.getBoundingBox(
        `[data-overlay-index="7"]`
      )
      ang = await u.getAngle(`[data-overlay-index="7"]`)
      console.log('angledLineOfXLength1')
      await clickConstrained({
        hoverPos: { x: angledLineOfXLength.x, y: angledLineOfXLength.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)',
        expectAfterUnconstrained:
          'angledLineOfXLength({ angle: -179, length: 23.14 }, %)',
        expectFinal:
          'angledLineOfXLength({ angle: angle001, length: 23.14 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })
      console.log('angledLineOfXLength2')
      await clickUnconstrained({
        hoverPos: { x: angledLineOfXLength.x, y: angledLineOfXLength.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained:
          'angledLineOfXLength({ angle: angle001, length: 23.14 }, %)',
        expectAfterUnconstrained:
          'angledLineOfXLength({ angle: angle001, length: xRel001 }, %)',
        expectFinal:
          'angledLineOfXLength({ angle: angle001, length: 23.14 }, %)',
        steps: 7,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })

      const angledLineOfYLength = await u.getBoundingBox(
        `[data-overlay-index="8"]`
      )
      ang = await u.getAngle(`[data-overlay-index="8"]`)
      console.log('angledLineOfYLength1')
      await clickUnconstrained({
        hoverPos: { x: angledLineOfYLength.x, y: angledLineOfYLength.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLineOfYLength({ angle: angle002, length: 19 + 0 }, %)',
        expectFinal: 'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="8"]',
      })
      console.log('angledLineOfYLength2')
      await clickConstrained({
        hoverPos: { x: angledLineOfYLength.x, y: angledLineOfYLength.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained:
          'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLineOfYLength({ angle: -91, length: 19 }, %)',
        expectFinal: 'angledLineOfYLength({ angle: -91, length: yRel002 }, %)',
        ang: ang + 180,
        steps: 7,
        locator: '[data-overlay-toolbar-index="8"]',
      })
    })
    test('for segments [angledLineToX, angledLineToY, angledLineThatIntersects]', async ({
      page,
    }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([0, 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([33, 11.5 + 0], %)
    |> xLineTo(9 - 5, %)
    |> yLineTo(-10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
    |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([3.14 + 13, 1.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      let ang = 0

      const angledLineToX = await u.getBoundingBox(`[data-overlay-index="9"]`)
      ang = await u.getAngle(`[data-overlay-index="9"]`)
      console.log('angledLineToX')
      await clickConstrained({
        hoverPos: { x: angledLineToX.x, y: angledLineToX.y },
        constraintType: 'angle',
        expectBeforeUnconstrained: 'angledLineToX({ angle: 3 + 0, to: 26 }, %)',
        expectAfterUnconstrained: 'angledLineToX({ angle: 3, to: 26 }, %)',
        expectFinal: 'angledLineToX({ angle: angle001, to: 26 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })
      console.log('angledLineToX2')
      await clickUnconstrained({
        hoverPos: { x: angledLineToX.x, y: angledLineToX.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained:
          'angledLineToX({ angle: angle001, to: 26 }, %)',
        expectAfterUnconstrained:
          'angledLineToX({ angle: angle001, to: xAbs001 }, %)',
        expectFinal: 'angledLineToX({ angle: angle001, to: 26 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })

      const angledLineToY = await u.getBoundingBox(`[data-overlay-index="10"]`)
      ang = await u.getAngle(`[data-overlay-index="10"]`)
      console.log('angledLineToY')
      await clickUnconstrained({
        hoverPos: { x: angledLineToY.x, y: angledLineToY.y },
        constraintType: 'angle',
        expectBeforeUnconstrained:
          'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        expectAfterUnconstrained:
          'angledLineToY({ angle: angle002, to: 9.14 + 0 }, %)',
        expectFinal: 'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        steps: process.platform === 'darwin' ? 8 : 9,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })
      console.log('angledLineToY2')
      await clickConstrained({
        hoverPos: { x: angledLineToY.x, y: angledLineToY.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained:
          'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        expectAfterUnconstrained: 'angledLineToY({ angle: 89, to: 9.14 }, %)',
        expectFinal: 'angledLineToY({ angle: 89, to: yAbs001 }, %)',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })

      const angledLineThatIntersects = await u.getBoundingBox(
        `[data-overlay-index="11"]`
      )
      ang = await u.getAngle(`[data-overlay-index="11"]`)
      console.log('angledLineThatIntersects')
      await clickUnconstrained({
        hoverPos: {
          x: angledLineThatIntersects.x,
          y: angledLineThatIntersects.y,
        },
        constraintType: 'angle',
        expectBeforeUnconstrained: `angledLineThatIntersects({
      angle: 4.14,
      intersectTag: a,
      offset: 9
    }, %)`,
        expectAfterUnconstrained: `angledLineThatIntersects({
      angle: angle003,
      intersectTag: a,
      offset: 9
    }, %)`,
        expectFinal: `angledLineThatIntersects({
      angle: -176,
      offset: 9,
      intersectTag: a
    }, %)`,
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
        expectBeforeUnconstrained: `angledLineThatIntersects({
      angle: -176,
      offset: 9,
      intersectTag: a
    }, %)`,
        expectAfterUnconstrained: `angledLineThatIntersects({
      angle: -176,
      offset: perpDist001,
      intersectTag: a
    }, %)`,
        expectFinal: `angledLineThatIntersects({
      angle: -176,
      offset: 9,
      intersectTag: a
    }, %)`,
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="11"]',
      })
    })
    test('for segment [tangentialArcTo]', async ({ page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
    |> startProfileAt([0, 0], %)
    |> line([0.5, -14 + 0], %)
    |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
    |> lineTo([33, 11.5 + 0], %)
    |> xLineTo(9 - 5, %)
    |> yLineTo(-10.77, %, $a)
    |> xLine(26.04, %)
    |> yLine(21.14 + 0, %)
    |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
    |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
    |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
    |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
    |> angledLineThatIntersects({
          angle: 4.14,
          intersectTag: a,
          offset: 9
        }, %)
    |> tangentialArcTo([3.14 + 13, -3.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      const tangentialArcTo = await u.getBoundingBox(
        '[data-overlay-index="12"]'
      )
      let ang = await u.getAngle('[data-overlay-index="12"]')
      console.log('tangentialArcTo')
      await clickConstrained({
        hoverPos: { x: tangentialArcTo.x, y: tangentialArcTo.y },
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained: 'tangentialArcTo([3.14 + 13, -3.14], %)',
        expectAfterUnconstrained: 'tangentialArcTo([16.14, -3.14], %)',
        expectFinal: 'tangentialArcTo([xAbs001, -3.14], %)',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="12"]',
      })
      console.log('tangentialArcTo2')
      await clickUnconstrained({
        hoverPos: { x: tangentialArcTo.x, y: tangentialArcTo.y },
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained: 'tangentialArcTo([xAbs001, -3.14], %)',
        expectAfterUnconstrained: 'tangentialArcTo([xAbs001, yAbs001], %)',
        expectFinal: 'tangentialArcTo([xAbs001, -3.14], %)',
        ang: ang + 180,
        steps: 10,
        locator: '[data-overlay-toolbar-index="12"]',
      })
    })
    test('for segment [circle]', async ({ page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
  |> circle({ center: [1 + 0, 0], radius: 8 }, %)
`
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page
        .getByText('circle({ center: [1 + 0, 0], radius: 8 }, %)')
        .click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(1)

      const clickUnconstrained = _clickUnconstrained(page)
      const clickConstrained = _clickConstrained(page)

      const hoverPos = { x: 789, y: 114 } as const
      let ang = await u.getAngle('[data-overlay-index="0"]')
      console.log('angl', ang)
      console.log('circle center x')
      await clickConstrained({
        hoverPos,
        constraintType: 'xAbsolute',
        expectBeforeUnconstrained:
          'circle({ center: [1 + 0, 0], radius: 8 }, %)',
        expectAfterUnconstrained: 'circle({ center: [1, 0], radius: 8 }, %)',
        expectFinal: 'circle({ center: [xAbs001, 0], radius: 8 }, %)',
        ang: ang + 105,
        steps: 6,
        locator: '[data-overlay-toolbar-index="0"]',
      })
      console.log('circle center y')
      await clickUnconstrained({
        hoverPos,
        constraintType: 'yAbsolute',
        expectBeforeUnconstrained:
          'circle({ center: [xAbs001, 0], radius: 8 }, %)',
        expectAfterUnconstrained:
          'circle({ center: [xAbs001, yAbs001], radius: 8 }, %)',
        expectFinal: 'circle({ center: [xAbs001, 0], radius: 8 }, %)',
        ang: ang + 105,
        steps: 10,
        locator: '[data-overlay-toolbar-index="0"]',
      })
      console.log('circle radius')
      await clickUnconstrained({
        hoverPos,
        constraintType: 'radius',
        expectBeforeUnconstrained:
          'circle({ center: [xAbs001, 0], radius: 8 }, %)',
        expectAfterUnconstrained:
          'circle({ center: [xAbs001, 0], radius: radius001 }, %)',
        expectFinal: 'circle({ center: [xAbs001, 0], radius: 8 }, %)',
        ang: ang + 105,
        steps: 10,
        locator: '[data-overlay-toolbar-index="0"]',
      })
    })
  })
  test.describe('Testing deleting a segment', () => {
    const _deleteSegmentSequence =
      (page: Page) =>
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

        await expect(page.locator('.cm-content')).toContainText(codeToBeDeleted)

        await page.locator(`[data-stdlib-fn-name="${stdLibFnName}"]`).click()
        await page.getByText('Delete Segment').click()

        await expect(page.locator('.cm-content')).not.toContainText(
          codeToBeDeleted
        )
      }
    test('all segment types', async ({ page }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `const part001 = startSketchOn('XZ')
  |> startProfileAt([0, 0], %)
  |> line([0.5, -14 + 0], %)
  |> angledLine({ angle: 3 + 0, length: 32 + 0 }, %)
  |> lineTo([33, 11.5 + 0], %)
  |> xLineTo(9 - 5, %)
  |> yLineTo(-10.77, %, $a)
  |> xLine(26.04, %)
  |> yLine(21.14 + 0, %)
  |> angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)
  |> angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)
  |> angledLineToX({ angle: 3 + 0, to: 26 }, %)
  |> angledLineToY({ angle: 89, to: 9.14 + 0 }, %)
  |> angledLineThatIntersects({
       angle: 4.14,
       intersectTag: a,
       offset: 9
     }, %)
  |> tangentialArcTo([3.14 + 13, 1.14], %)
        `
        )
        localStorage.setItem('disableAxis', 'true')
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      await u.waitForAuthSkipAppStart()

      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.closeDebugPanel()

      await page.getByText('xLineTo(9 - 5, %)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(13)
      const deleteSegmentSequence = _deleteSegmentSequence(page)

      let segmentToDelete

      const getOverlayByIndex = (index: number) =>
        u.getBoundingBox(`[data-overlay-index="${index}"]`)
      segmentToDelete = await getOverlayByIndex(12)
      let ang = await u.getAngle(`[data-overlay-index="${12}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'tangentialArcTo([3.14 + 13, 1.14], %)',
        stdLibFnName: 'tangentialArcTo',
        ang: ang + 180,
        steps: 6,
        locator: '[data-overlay-toolbar-index="12"]',
      })

      segmentToDelete = await getOverlayByIndex(11)
      ang = await u.getAngle(`[data-overlay-index="${11}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: `angledLineThatIntersects({
      angle: 4.14,
      intersectTag: a,
      offset: 9
    }, %)`,
        stdLibFnName: 'angledLineThatIntersects',
        ang: ang + 180,
        steps: 7,
        locator: '[data-overlay-toolbar-index="11"]',
      })

      segmentToDelete = await getOverlayByIndex(10)
      ang = await u.getAngle(`[data-overlay-index="${10}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLineToY({ angle: 89, to: 9.14 + 0 }, %)',
        stdLibFnName: 'angledLineToY',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="10"]',
      })

      segmentToDelete = await getOverlayByIndex(9)
      ang = await u.getAngle(`[data-overlay-index="${9}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLineToX({ angle: 3 + 0, to: 26 }, %)',
        stdLibFnName: 'angledLineToX',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="9"]',
      })

      segmentToDelete = await getOverlayByIndex(8)
      ang = await u.getAngle(`[data-overlay-index="${8}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted:
          'angledLineOfYLength({ angle: -91, length: 19 + 0 }, %)',
        stdLibFnName: 'angledLineOfYLength',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="8"]',
      })

      segmentToDelete = await getOverlayByIndex(7)
      ang = await u.getAngle(`[data-overlay-index="${7}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted:
          'angledLineOfXLength({ angle: 181 + 0, length: 23.14 }, %)',
        stdLibFnName: 'angledLineOfXLength',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="7"]',
      })

      segmentToDelete = await getOverlayByIndex(6)
      ang = await u.getAngle(`[data-overlay-index="${6}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'yLine(21.14 + 0, %)',
        stdLibFnName: 'yLine',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="6"]',
      })

      segmentToDelete = await getOverlayByIndex(5)
      ang = await u.getAngle(`[data-overlay-index="${5}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'xLine(26.04, %)',
        stdLibFnName: 'xLine',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="5"]',
      })

      segmentToDelete = await getOverlayByIndex(4)
      ang = await u.getAngle(`[data-overlay-index="${4}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'yLineTo(-10.77, %, $a)',
        stdLibFnName: 'yLineTo',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="4"]',
      })

      segmentToDelete = await getOverlayByIndex(3)
      ang = await u.getAngle(`[data-overlay-index="${3}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'xLineTo(9 - 5, %)',
        stdLibFnName: 'xLineTo',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="3"]',
      })

      segmentToDelete = await getOverlayByIndex(2)
      ang = await u.getAngle(`[data-overlay-index="${2}"]`)
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
        '[data-overlay-toolbar-index="2"]'
      )

      const codeToBeDeleted = 'lineTo([33, 11.5 + 0], %)'
      await expect(page.locator('.cm-content')).toContainText(codeToBeDeleted)

      await page.getByTestId('overlay-menu').click()
      await page.getByText('Delete Segment').click()

      await expect(page.locator('.cm-content')).not.toContainText(
        codeToBeDeleted
      )

      segmentToDelete = await getOverlayByIndex(1)
      ang = await u.getAngle(`[data-overlay-index="${1}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'angledLine({ angle: 3 + 0, length: 32 + 0 }, %)',
        stdLibFnName: 'angledLine',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })

      segmentToDelete = await getOverlayByIndex(0)
      ang = await u.getAngle(`[data-overlay-index="${0}"]`)
      await deleteSegmentSequence({
        hoverPos: { x: segmentToDelete.x, y: segmentToDelete.y },
        codeToBeDeleted: 'line([0.5, -14 + 0], %)',
        stdLibFnName: 'line',
        ang: ang + 180,
      })

      await page.waitForTimeout(200)
    })
  })
  test.describe('Testing delete with dependent segments', () => {
    const cases = [
      'line([22, 2], %, $seg01)',
      'angledLine([5, 23.03], %, $seg01)',
      'xLine(23, %, $seg01)',
      'yLine(-8, %, $seg01)',
      'xLineTo(30, %, $seg01)',
      'yLineTo(-4, %, $seg01)',
      'angledLineOfXLength([3, 30], %, $seg01)',
      'angledLineOfXLength({ angle: 3, length: 30 }, %, $seg01)',
      'angledLineOfYLength([3, 1.5], %, $seg01)',
      'angledLineOfYLength({ angle: 3, length: 1.5 }, %, $seg01)',
      'angledLineToX([3, 30], %, $seg01)',
      'angledLineToX({ angle: 3, to: 30 }, %, $seg01)',
      'angledLineToY([3, 7], %, $seg01)',
      'angledLineToY({ angle: 3, to: 7 }, %, $seg01)',
    ]
    for (const doesHaveTagOutsideSketch of [true, false]) {
      for (const lineOfInterest of cases) {
        const isObj = lineOfInterest.includes('{ angle: 3,')
        test(`${lineOfInterest.split('(')[0]}${isObj ? '-[obj-input]' : ''}${
          doesHaveTagOutsideSketch ? '-[tagOutsideSketch]' : ''
        }`, async ({ page }) => {
          await page.addInitScript(
            async ({ lineToBeDeleted, extraLine }) => {
              localStorage.setItem(
                'persistCode',
                `const part001 = startSketchOn('XZ')
  |> startProfileAt([5, 6], %)
  |> ${lineToBeDeleted}
  |> line([-10, -15], %)
  |> angledLine([-176, segLen(seg01)], %)        
${extraLine ? 'const myVar = segLen(seg01)' : ''}`
              )
            },
            {
              lineToBeDeleted: lineOfInterest,
              extraLine: doesHaveTagOutsideSketch,
            }
          )
          const u = await getUtils(page)
          await page.setViewportSize({ width: 1200, height: 500 })

          await u.waitForAuthSkipAppStart()
          await page.waitForTimeout(300)

          await page.getByText(lineOfInterest).click()
          await page.waitForTimeout(100)
          await page.getByRole('button', { name: 'Edit Sketch' }).click()
          await page.waitForTimeout(500)

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

          await expect(page.locator('.cm-content')).toContainText(
            lineOfInterest
          )

          await page.getByTestId('overlay-menu').click()
          await page.waitForTimeout(100)
          await page.getByText('Delete Segment').click()

          await page.getByText('Cancel').click()

          await page.mouse.move(hoverPos.x + x, hoverPos.y + y)
          await page.mouse.move(hoverPos.x, hoverPos.y, { steps: 5 })

          await expect(page.locator('.cm-content')).toContainText(
            lineOfInterest
          )

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
            await expect(page.locator('.cm-content')).toContainText(
              lineOfInterest
            )
          } else {
            // eslint-disable-next-line jest/no-conditional-expect
            await expect(page.locator('.cm-content')).not.toContainText(
              lineOfInterest
            )
            // eslint-disable-next-line jest/no-conditional-expect
            await expect(page.locator('.cm-content')).not.toContainText('seg01')
          }
        })
      }
    }
  })
  test.describe('Testing remove constraints segments', () => {
    const cases = [
      {
        before: `line([22 + 0, 2 + 0], %, $seg01)`,
        after: `line([22, 2], %, $seg01)`,
      },

      {
        before: `angledLine([5 + 0, 23.03 + 0], %, $seg01)`,
        after: `line([22.94, 2.01], %, $seg01)`,
      },
      {
        before: `xLine(23 + 0, %, $seg01)`,
        after: `line([23, 0], %, $seg01)`,
      },
      {
        before: `yLine(-8 + 0, %, $seg01)`,
        after: `line([0, -8], %, $seg01)`,
      },
      {
        before: `xLineTo(30 + 0, %, $seg01)`,
        after: `line([25, 0], %, $seg01)`,
      },
      {
        before: `yLineTo(-4 + 0, %, $seg01)`,
        after: `line([0, -10], %, $seg01)`,
      },
      {
        before: `angledLineOfXLength([3 + 0, 30 + 0], %, $seg01)`,
        after: `line([30, 1.57], %, $seg01)`,
      },
      {
        before: `angledLineOfYLength([3 + 0, 1.5 + 0], %, $seg01)`,
        after: `line([28.62, 1.5], %, $seg01)`,
      },
      {
        before: `angledLineToX([3 + 0, 30 + 0], %, $seg01)`,
        after: `line([25, 1.31], %, $seg01)`,
      },
      {
        before: `angledLineToY([3 + 0, 7 + 0], %, $seg01)`,
        after: `line([19.08, 1], %, $seg01)`,
      },
      {
        before: `angledLineOfXLength({ angle: 3 + 0, length: 30 + 0 }, %, $seg01)`,
        after: `line([30, 1.57], %, $seg01)`,
      },
      {
        before: `angledLineOfYLength({ angle: 3 + 0, length: 1.5 + 0 }, %, $seg01)`,
        after: `line([28.62, 1.5], %, $seg01)`,
      },
      {
        before: `angledLineToX({ angle: 3 + 0, to: 30 + 0 }, %, $seg01)`,
        after: `line([25, 1.31], %, $seg01)`,
      },
      {
        before: `angledLineToY({ angle: 3 + 0, to: 7 + 0 }, %, $seg01)`,
        after: `line([19.08, 1], %, $seg01)`,
      },
    ]

    for (const { before, after } of cases) {
      const isObj = before.includes('{ angle: 3')
      test(`${before.split('(')[0]}${isObj ? '-[obj-input]' : ''}`, async ({
        page,
      }) => {
        await page.addInitScript(
          async ({ lineToBeDeleted }) => {
            localStorage.setItem(
              'persistCode',
              `const part001 = startSketchOn('XZ')
  |> startProfileAt([5, 6], %)
  |> ${lineToBeDeleted}
  |> line([-10, -15], %)
  |> angledLine([-176, segLen(seg01)], %)`
            )
          },
          {
            lineToBeDeleted: before,
          }
        )
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()
        await page.waitForTimeout(300)

        await page.getByText(before).click()
        await page.waitForTimeout(100)
        await page.getByRole('button', { name: 'Edit Sketch' }).click()
        await page.waitForTimeout(500)

        await expect(page.getByTestId('segment-overlay')).toHaveCount(3)
        await expect(page.getByText('Added variable')).not.toBeVisible()

        const hoverPos = await u.getBoundingBox(`[data-overlay-index="0"]`)
        let ang = await u.getAngle(`[data-overlay-index="${0}"]`)
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
          '[data-overlay-toolbar-index="0"]'
        )

        await expect(page.locator('.cm-content')).toContainText(before)

        await page.getByTestId('overlay-menu').click()
        await page.waitForTimeout(100)
        await page.getByText('Remove constraints').click()

        await expect(page.locator('.cm-content')).toContainText(after)
        // check the cursor was left in the correct place after transform
        await expect(page.locator('.cm-activeLine')).toHaveText('|> ' + after)
        await expect(page.getByTestId('segment-overlay')).toHaveCount(3)
      })
    }
  })
})
