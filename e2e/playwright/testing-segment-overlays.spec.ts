import type { Page } from '@playwright/test'
import type { LineInputsType } from '@src/lang/std/sketchcombos'
import { uuidv4 } from '@src/lib/utils'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import { deg, getUtils, wiggleMove } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Testing segment overlays', { tag: '@desktop' }, () => {
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
      (page: Page, editor: EditorFixture, cmdBar: CmdBarFixture) =>
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

        const constrainedLocator = page.locator(
          `[data-constraint-type="${constraintType}"][data-is-constrained="true"]`
        )

        await page.mouse.move(x, y)
        await wiggleMove(page, x, y, 20, 30, ang, 10, 5, locator)
        await page.mouse.move(x, y)

        await editor.expectEditor.toContain(expectBeforeUnconstrained, {
          shouldNormalise: true,
        })
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
        await page.waitForTimeout(500)
        await cmdBar.continue()
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
      (page: Page, editor: EditorFixture, cmdBar: CmdBarFixture) =>
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
        await page.waitForTimeout(500)
        await cmdBar.continue()
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
    test('for a line segment', async ({
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
        |> startProfile(at = [5 + 0, 20 + 0])
        |> line(end = [0.5, -12 + 0])
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
      await await scene.settled(cmdBar)

      // wait for execution done

      await page.getByText('xLine(endAbsolute = 5 + 9 - 5)').click()
      await page.waitForTimeout(100)
      await page.getByRole('button', { name: 'Edit Sketch' }).click()
      await page.waitForTimeout(500)

      await expect(page.getByTestId('segment-overlay')).toHaveCount(14)

      const clickUnconstrained = _clickUnconstrained(page, editor, cmdBar)
      const clickConstrained = _clickConstrained(page, editor, cmdBar)

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
      await page.waitForTimeout(1000)
      await u.closeDebugPanel()

      let ang = 0

      const line = await u.getBoundingBox('[data-overlay-index="1"]')
      ang = await u.getAngle('[data-overlay-index="1"]')
      console.log('line1', line, ang)
      await clickConstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'yRelative',
        expectBeforeUnconstrained: '|> line(end = [0.5, -12 + 0])',
        expectAfterUnconstrained: '|> line(end = [0.5, -12])',
        expectFinal: '|> line(end = [0.5, yRel001])',
        ang: ang + 180,
        locator: '[data-overlay-toolbar-index="1"]',
      })
      console.log('line2')
      await clickUnconstrained({
        hoverPos: { x: line.x, y: line.y },
        constraintType: 'xRelative',
        expectBeforeUnconstrained: '|> line(end = [0.5, yRel001])',
        expectAfterUnconstrained: 'line(end = [xRel001, yRel001])',
        expectFinal: '|> line(end = [0.5, yRel001])',
        ang: ang + 180,
        locator: '[data-overlay-index="1"]',
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
      await cmdBar.continue()

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
      await cmdBar.continue()

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
      await cmdBar.continue()

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
    await cmdBar.continue()

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
    await cmdBar.continue()

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
    await cmdBar.continue()

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
    await cmdBar.continue()

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
