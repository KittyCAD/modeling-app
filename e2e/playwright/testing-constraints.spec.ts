import { test, expect } from '@playwright/test'

import { getUtils, setup, tearDown, TEST_COLORS } from './test-utils'
import { XOR } from 'lib/utils'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Testing constraints', () => {
  test('Can constrain line length', async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line([20, 0], %)
  |> line([0, 20], %)
  |> xLine(-20, %)
`
      )
    })

    const u = await getUtils(page)
    // constants and locators
    const lengthValue = {
      old: '20',
      new: '25',
    }
    const cmdBarKclInput = page
      .getByTestId('cmd-bar-arg-value')
      .getByRole('textbox')
    const cmdBarSubmitButton = page.getByRole('button', {
      name: 'arrow right Continue',
    })
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Click the line of code for line.
    // TODO remove this and reinstate `await topHorzSegmentClick()`
    await page.getByText(`line([0, ${lengthValue.old}], %)`).click()
    await page.waitForTimeout(100)

    // enter sketch again
    await page.getByRole('button', { name: 'Edit Sketch' }).click()
    await page.waitForTimeout(500) // wait for animation
    await page
      .getByRole('button', { name: 'dimension Length', exact: true })
      .click()
    await expect(cmdBarKclInput).toHaveText('20')
    await cmdBarKclInput.fill(lengthValue.new)
    await expect(
      page.getByText(`Can't calculate`),
      `Something went wrong with the KCL expression evaluation`
    ).not.toBeVisible()
    await cmdBarSubmitButton.click()

    await expect(page.locator('.cm-content')).toHaveText(
      `length001 = ${lengthValue.new}sketch001 = startSketchOn('XY')  |> startProfileAt([-10, -10], %)  |> line([20, 0], %)  |> angledLine([90, length001], %)  |> xLine(-20, %)`
    )

    // Make sure we didn't pop out of sketch mode.
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()

    await page.waitForTimeout(500) // wait for animation

    // Exit sketch
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).not.toBeVisible()
  })
  test(`Remove constraints`, async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `yo = 79
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %, $seg01)
  |> line([78.92, -120.11], %)
  |> angledLine([segAng(seg01), yo], %)
  |> line([41.19, 58.97 + 5], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 120], %)
  |> xLine(-385.34, %, $seg_what)
  |> yLine(-170.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
      )
    })
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await page.getByText('line([74.36, 130.4], %, $seg01)').click()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    const line3 = await u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`)

    await page.mouse.click(line3.x, line3.y)
    await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
    await page
      .getByRole('button', {
        name: 'Length: open menu',
      })
      .click()
    await page.getByRole('button', { name: 'remove constraints' }).click()

    await page.getByText('line([39.13, 68.63], %)').click()
    const activeLinesContent = await page.locator('.cm-activeLine').all()
    await expect(activeLinesContent).toHaveLength(1)
    await expect(activeLinesContent[0]).toHaveText('|> line([39.13, 68.63], %)')

    // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
    await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
  })
  test.describe('Test perpendicular distance constraint', () => {
    const cases = [
      {
        testName: 'Add variable',
        offset: '-offset001',
      },
      {
        testName: 'No variable',
        offset: '-128.05',
      },
    ] as const
    for (const { testName, offset } of cases) {
      test(`${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %, $seg01)
  |> line([78.92, -120.11], %)
  |> angledLine([segAng(seg01), 78.33], %)
  |> line([51.19, 48.97], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %, $seg01)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line1, line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`),
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Length: open menu',
          })
          .click()
        await page
          .getByRole('button', { name: 'Perpendicular Distance' })
          .click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        const addVariable = testName === 'Add variable'
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // Wait for the codemod to take effect
        await expect(page.locator('.cm-content')).toContainText(`angle = -57,`)
        await expect(page.locator('.cm-content')).toContainText(
          `offset = ${offset},`
        )

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await expect(activeLinesContent[0]).toHaveText(
          `|> line([74.36, 130.4], %, $seg01)`
        )
        await expect(activeLinesContent[1]).toHaveText(`}, %)`)

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test distance between constraint', () => {
    const cases = [
      {
        testName: 'Add variable',
        constraint: 'horizontal distance',
        value: 'segEndX(seg01) + xDis001, 61.34',
      },
      {
        testName: 'No variable',
        constraint: 'horizontal distance',
        value: 'segEndX(seg01) + 88.08, 61.34',
      },
      {
        testName: 'Add variable',
        constraint: 'vertical distance',
        value: '154.9, segEndY(seg01) - yDis001',
      },
      {
        testName: 'No variable',
        constraint: 'vertical distance',
        value: '154.9, segEndY(seg01) - 42.32',
      },
    ] as const
    for (const { testName, value, constraint } of cases) {
      test(`${constraint} - ${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([51.19, 48.97], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line1, line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`),
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Length: open menu',
          })
          .click()
        await page.getByRole('button', { name: constraint }).click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        const addVariable = testName === 'Add variable'
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // checking activeLines assures the cursors are where they should be
        const codeAfter = [
          `|> line([74.36, 130.4], %, $seg01)`,
          `|> lineTo([${value}], %)`,
        ]

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test ABS distance constraint', () => {
    const cases = [
      {
        testName: 'Add variable',
        addVariable: true,
        constraint: 'Absolute X',
        value: 'xDis001, 61.34',
      },
      {
        testName: 'No variable',
        addVariable: false,
        constraint: 'Absolute X',
        value: '154.9, 61.34',
      },
      {
        testName: 'Add variable',
        addVariable: true,
        constraint: 'Absolute Y',
        value: '154.9, yDis001',
      },
      {
        testName: 'No variable',
        addVariable: false,
        constraint: 'Absolute Y',
        value: '154.9, 61.34',
      },
    ] as const
    for (const { testName, addVariable, value, constraint } of cases) {
      test(`${constraint} - ${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([51.19, 48.97], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        if (constraint === 'Absolute X') {
          await page.mouse.click(600, 130)
        } else {
          await page.mouse.click(900, 250)
        }
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Length: open menu',
          })
          .click()
        await page
          .getByRole('button', { name: constraint, exact: true })
          .click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // checking activeLines assures the cursors are where they should be
        const codeAfter = [`|> lineTo([${value}], %)`]

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test Angle constraint double segment selection', () => {
    const cases = [
      {
        testName: 'Add variable',
        addVariable: true,
        axisSelect: false,
        value: 'segAng(seg01) + angle001',
      },
      {
        testName: 'No variable',
        addVariable: false,
        axisSelect: false,
        value: 'segAng(seg01) + 22.69',
      },
      {
        testName: 'Add variable, selecting axis',
        addVariable: true,
        axisSelect: true,
        value: 'QUARTER_TURN - angle001',
      },
      {
        testName: 'No variable, selecting axis',
        addVariable: false,
        axisSelect: true,
        value: 'QUARTER_TURN - 7',
      },
    ] as const
    for (const { testName, addVariable, value, axisSelect } of cases) {
      test(`${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([51.19, 48.97], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const [line1, line3] = await Promise.all([
          u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`),
          u.getSegmentBodyCoords(`[data-overlay-index="${2}"]`),
        ])

        if (axisSelect) {
          await page.mouse.click(600, 130)
        } else {
          await page.mouse.click(line1.x, line1.y)
        }
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'Length: open menu',
          })
          .click()
        await page.getByTestId('dropdown-constraint-angle').click()

        const createNewVariableCheckbox = page.getByTestId(
          'create-new-variable-checkbox'
        )
        const isChecked = await createNewVariableCheckbox.isChecked()
        XOR(isChecked, addVariable) && // XOR because no need to click the checkbox if the state is already correct
          (await createNewVariableCheckbox.click())

        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        // checking activeLines assures the cursors are where they should be
        const codeAfter = [
          '|> line([74.36, 130.4], %, $seg01)',
          `|> angledLine([${value}, 78.33], %)`,
        ]
        if (axisSelect) codeAfter.shift()

        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test Angle constraint single selection', () => {
    const cases = [
      {
        testName: 'Angle - Add variable',
        addVariable: true,
        constraint: 'angle',
        value: 'angle001, 78.33',
      },
      {
        testName: 'Angle - No variable',
        addVariable: false,
        constraint: 'angle',
        value: '83, 78.33',
      },
    ] as const
    for (const { testName, addVariable, value, constraint } of cases) {
      test(`${testName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([51.19, 48.97], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line3 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${2}"]`
        )

        await page.mouse.click(line3.x, line3.y)
        await page
          .getByRole('button', {
            name: 'Length: open menu',
          })
          .click()
        await page.getByTestId('dropdown-constraint-' + constraint).click()

        if (!addVariable) {
          await page.getByTestId('create-new-variable-checkbox').click()
        }
        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        const changedCode = `|> angledLine([${value}], %)`
        await expect(page.locator('.cm-content')).toContainText(changedCode)
        // checking active assures the cursor is where it should be
        await expect(page.locator('.cm-activeLine')).toHaveText(changedCode)

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Test Length constraint single selection', () => {
    const cases = [
      {
        testName: 'Length - Add variable',
        addVariable: true,
        constraint: 'length',
        value: '83, length001',
      },
      {
        testName: 'Length - No variable',
        addVariable: false,
        constraint: 'length',
        value: '83, 78.33',
      },
    ] as const
    for (const { testName, addVariable, value, constraint } of cases) {
      test(`${testName}`, async ({ page }) => {
        // constants and locators
        const cmdBarKclInput = page
          .getByTestId('cmd-bar-arg-value')
          .getByRole('textbox')
        const cmdBarKclVariableNameInput =
          page.getByPlaceholder('Variable name')
        const cmdBarSubmitButton = page.getByRole('button', {
          name: 'arrow right Continue',
        })

        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([51.19, 48.97], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line3 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${2}"]`
        )

        await page.mouse.click(line3.x, line3.y)
        await page
          .getByRole('button', {
            name: 'Length: open menu',
          })
          .click()
        await page.getByTestId('dropdown-constraint-' + constraint).click()

        if (!addVariable) {
          await test.step(`Clear the variable input`, async () => {
            await cmdBarKclVariableNameInput.clear()
            await cmdBarKclVariableNameInput.press('Backspace')
          })
        }
        await expect(cmdBarKclInput).toHaveText('78.33')
        await cmdBarSubmitButton.click()

        const changedCode = `|> angledLine([${value}], %)`
        await expect(page.locator('.cm-content')).toContainText(changedCode)
        // checking active assures the cursor is where it should be
        await expect(page.locator('.cm-activeLine')).toHaveText(changedCode)

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(4)
      })
    }
  })
  test.describe('Many segments - no modal constraints', () => {
    const cases = [
      {
        constraintName: 'Vertical',
        codeAfter: [
          `|> yLine(130.4, %)`,
          `|> yLine(77.79, %)`,
          `|> yLine(48.97, %)`,
        ],
      },
      {
        codeAfter: [
          `|> xLine(74.36, %)`,
          `|> xLine(9.16, %)`,
          `|> xLine(51.19, %)`,
        ],
        constraintName: 'Horizontal',
      },
    ] as const
    for (const { codeAfter, constraintName } of cases) {
      test(`${constraintName}`, async ({ page }) => {
        await page.addInitScript(async (customCode) => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
  |> line([51.19, 48.97], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line1 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${0}"]`
        )
        const line3 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${2}"]`
        )
        const line4 = await u.getSegmentBodyCoords(
          `[data-overlay-index="${3}"]`
        )

        // select two segments by holding down shift
        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.mouse.click(line4.x, line4.y)
        await page.keyboard.up('Shift')

        // check actives lines
        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await expect(activeLinesContent).toHaveLength(codeAfter.length)

        const constraintMenuButton = page.getByRole('button', {
          name: 'Length: open menu',
        })
        const constraintButton = page
          .getByRole('button', {
            name: constraintName,
          })
          .first()

        // apply the constraint
        await constraintMenuButton.click()
        await constraintButton.click({ delay: 200 })

        // check there are still 3 cursors (they should stay on the same lines as before constraint was applied)
        await expect(page.locator('.cm-cursor')).toHaveCount(codeAfter.length)

        // check both cursors are where they should be after constraint is applied and the code is correct
        await Promise.all(
          activeLinesContent.map(async (line, i) => {
            await expect(page.locator('.cm-content')).toContainText(
              codeAfter[i]
            )
            // if the code is an active line then the cursor should be on that line
            await expect(line).toHaveText(codeAfter[i])
          })
        )
      })
    }
  })
  test.describe('Two segment - no modal constraints', () => {
    const cases = [
      {
        codeAfter: `|> angledLine([83, segLen(seg01)], %)`,
        constraintName: 'Equal Length',
      },
      {
        codeAfter: `|> angledLine([segAng(seg01), 78.33], %)`,
        constraintName: 'Parallel',
      },
      {
        codeAfter: `|> lineTo([segEndX(seg01), 61.34], %)`,
        constraintName: 'Vertically Align',
      },
      {
        codeAfter: `|> lineTo([154.9, segEndY(seg01)], %)`,
        constraintName: 'Horizontally Align',
      },
    ] as const
    for (const { codeAfter, constraintName } of cases) {
      test(`${constraintName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line1 = await u.getBoundingBox(`[data-overlay-index="${0}"]`)
        const line3 = await u.getBoundingBox(`[data-overlay-index="${2}"]`)

        // select two segments by holding down shift
        await page.mouse.click(line1.x - 20, line1.y + 20)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x - 3, line3.y + 20)
        await page.keyboard.up('Shift')
        const constraintMenuButton = page.getByRole('button', {
          name: 'Length: open menu',
        })
        const constraintButton = page.getByRole('button', {
          name: constraintName,
        })

        // apply the constraint
        await constraintMenuButton.click()
        await constraintButton.click()

        await expect(page.locator('.cm-content')).toContainText(codeAfter)
        // expect the string 'seg01' to appear twice in '.cm-content' the tag segment and referencing the tag
        const content = await page.locator('.cm-content').innerText()
        await expect(content.match(/seg01/g)).toHaveLength(2)
        // check there are still 2 cursors (they should stay on the same lines as before constraint was applied)
        await expect(page.locator('.cm-cursor')).toHaveCount(2)
        // check actives lines
        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await expect(activeLinesContent).toHaveLength(2)

        // check both cursors are where they should be after constraint is applied
        await expect(activeLinesContent[0]).toHaveText(
          '|> line([74.36, 130.4], %, $seg01)'
        )
        await expect(activeLinesContent[1]).toHaveText(codeAfter)
      })
    }
  })
  test.describe('Axis & segment - no modal constraints', () => {
    const cases = [
      {
        codeAfter: `|> lineTo([154.9, ZERO], %)`,
        axisClick: { x: 950, y: 250 },
        constraintName: 'Snap To X',
      },
      {
        codeAfter: `|> lineTo([ZERO, 61.34], %)`,
        axisClick: { x: 600, y: 150 },
        constraintName: 'Snap To Y',
      },
    ] as const
    for (const { codeAfter, constraintName, axisClick } of cases) {
      test(`${constraintName}`, async ({ page }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `yo = 5
part001 = startSketchOn('XZ')
  |> startProfileAt([-7.54, -26.74], %)
  |> line([74.36, 130.4], %)
  |> line([78.92, -120.11], %)
  |> line([9.16, 77.79], %)
part002 = startSketchOn('XZ')
  |> startProfileAt([299.05, 231.45], %)
  |> xLine(-425.34, %, $seg_what)
  |> yLine(-264.06, %)
  |> xLine(segLen(seg_what), %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)`
          )
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })

        await u.waitForAuthSkipAppStart()

        await page.getByText('line([74.36, 130.4], %)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line3 = await u.getBoundingBox(`[data-overlay-index="${2}"]`)

        // select segment and axis by holding down shift
        await page.mouse.click(line3.x - 3, line3.y + 20)
        await page.keyboard.down('Shift')
        await page.waitForTimeout(100)
        await page.mouse.click(axisClick.x, axisClick.y)
        await page.keyboard.up('Shift')
        const constraintMenuButton = page.getByRole('button', {
          name: 'Length: open menu',
        })
        const constraintButton = page.getByRole('button', {
          name: constraintName,
        })

        // apply the constraint
        await constraintMenuButton.click()
        await expect(constraintButton).toBeVisible()
        await constraintButton.click()

        // check the cursor is where is should be after constraint is applied
        await expect(page.locator('.cm-content')).toContainText(codeAfter)
        await expect(page.locator('.cm-activeLine')).toHaveText(codeAfter)
      })
    }
  })

  test('Horizontally constrained line remains selected after applying constraint', async ({
    page,
  }) => {
    test.setTimeout(70_000)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XY')
  |> startProfileAt([-1.05, -1.07], %)
  |> line([3.79, 2.68], %, $seg01)
  |> line([3.13, -2.4], %)`
      )
    })

    // constants and locators
    const cmdBarKclInput = page
      .getByTestId('cmd-bar-arg-value')
      .getByRole('textbox')
    const cmdBarSubmitButton = page.getByRole('button', {
      name: 'arrow right Continue',
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await page.getByText('line([3.79, 2.68], %, $seg01)').click()
    await expect(page.getByRole('button', { name: 'Edit Sketch' })).toBeEnabled(
      { timeout: 10_000 }
    )
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    await page.waitForTimeout(100)
    const lineBefore = await u.getSegmentBodyCoords(
      `[data-overlay-index="1"]`,
      0
    )
    expect(
      await u.getGreatestPixDiff(lineBefore, TEST_COLORS.WHITE)
    ).toBeLessThan(3)
    await page.mouse.move(lineBefore.x, lineBefore.y)
    await page.waitForTimeout(50)
    await page.mouse.click(lineBefore.x, lineBefore.y)
    expect(
      await u.getGreatestPixDiff(lineBefore, TEST_COLORS.BLUE)
    ).toBeLessThan(3)

    await page
      .getByRole('button', {
        name: 'Length: open menu',
      })
      .click()
    await page.getByRole('button', { name: 'Horizontal', exact: true }).click()

    let activeLinesContent = await page.locator('.cm-activeLine').all()
    await expect(activeLinesContent[0]).toHaveText(`|> xLine(3.13, %)`)

    // If the overlay-angle is updated the THREE.js scene is in a good state
    await expect(
      await page.locator('[data-overlay-index="1"]')
    ).toHaveAttribute('data-overlay-angle', '0')

    const lineAfter = await u.getSegmentBodyCoords(
      `[data-overlay-index="1"]`,
      0
    )
    expect(
      await u.getGreatestPixDiff(lineAfter, TEST_COLORS.BLUE)
    ).toBeLessThan(3)

    await page.waitForTimeout(300)
    await page
      .getByRole('button', {
        name: 'Length: open menu',
      })
      .click()
    // await expect(page.getByRole('button', { name: 'length', exact: true })).toBeVisible()
    await page.waitForTimeout(200)
    // await page.getByRole('button', { name: 'length', exact: true }).click()
    await page.getByTestId('dropdown-constraint-length').click()

    await cmdBarKclInput.fill('10')
    await cmdBarSubmitButton.click()

    activeLinesContent = await page.locator('.cm-activeLine').all()
    await expect(activeLinesContent[0]).toHaveText(`|> xLine(length001, %)`)

    // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
    await expect(page.getByTestId('segment-overlay')).toHaveCount(2)
  })
})
