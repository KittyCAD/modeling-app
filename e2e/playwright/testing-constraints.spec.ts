import path from 'node:path'
import { XOR } from '@src/lib/utils'
import * as fsp from 'fs/promises'

import {
  getUtils,
  pollEditorLinesSelectedLength,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Testing constraints', () => {
  test('Can constrain line length', async ({ page, homePage, cmdBar }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> xLine(length = -20)
`
      )
    })

    const u = await getUtils(page)
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Click the line of code for line.
    await page.getByText(`line(end = [0, 20])`).click() // TODO remove this and reinstate // await topHorzSegmentClick()
    await page.waitForTimeout(100)

    // enter sketch again
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    // Wait for overlays to populate
    await page.waitForTimeout(1000)

    const startXPx = 500

    await page.getByText(`line(end = [0, 20])`).click()
    await page.waitForTimeout(100)
    await page.getByTestId('constraint-length').click()
    await page.getByTestId('cmd-bar-arg-value').getByRole('textbox').fill('20')
    await cmdBar.continue()

    await expect(page.locator('.cm-content')).toHaveText(
      `length001 = 20sketch001 = startSketchOn(XY)  |> startProfile(at = [-10, -10])  |> line(end = [20, 0])  |> angledLine(angle = 90, length = length001)  |> xLine(length = -20)`
    )

    // Make sure we didn't pop out of sketch mode.
    await expect(
      page.getByRole('button', { name: 'Exit Sketch' })
    ).toBeVisible()

    await page.waitForTimeout(2500) // wait for animation

    // Exit sketch
    await page.mouse.move(startXPx + PUR * 15, 250 - PUR * 10)
    await expect
      .poll(async () => {
        await page.keyboard.press('Escape', { delay: 500 })
        return page.getByRole('button', { name: 'Exit Sketch' }).isVisible()
      })
      .toBe(false)
  })
  test(`Remove constraints`, async ({ page, homePage, scene, cmdBar }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `@settings(defaultLengthUnit = in)
  yo = 79
  part001 = startSketchOn(XZ)
    |> startProfile(at = [-7.54, -26.74])
    |> line(end = [74.36, 130.4], tag = $seg01)
    |> line(end = [78.92, -120.11])
    |> angledLine(angle = segAng(seg01), length = yo)
    |> line(end = [41.19, 58.97 + 5])
  part002 = startSketchOn(XZ)
    |> startProfile(at = [299.05, 120])
    |> xLine(length = -385.34, tag = $seg_what)
    |> yLine(length = -170.06)
    |> xLine(length = segLen(seg_what))
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
      )
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    await page.getByText('line(end = [74.36, 130.4], tag = $seg01)').click()
    await page.getByRole('button', { name: 'Edit Sketch' }).click()

    // Wait for overlays to populate
    await page.waitForTimeout(1000)

    const line3 = await u.getBoundingBox(`[data-overlay-index="${3}"]`)

    await page.mouse.click(line3.x, line3.y)
    await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
    await page
      .getByRole('button', {
        name: 'constraints: open menu',
      })
      .click()
    await page.getByRole('button', { name: 'remove constraints' }).click()

    await page.getByText('line(end = [39.13, 68.63])').click()
    await pollEditorLinesSelectedLength(page, 1)
    const activeLinesContent = await page.locator('.cm-activeLine').all()
    await expect(activeLinesContent[0]).toHaveText(
      '|> line(end = [39.13, 68.63])'
    )

    // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
    await expect(page.getByTestId('segment-overlay')).toHaveCount(5)
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
      test(`${testName}`, async ({ page, homePage, scene, cmdBar, editor }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-7.54, -26.74])
        |> line(end = [74.36, 130.4], tag = $seg01)
        |> line(end = [78.92, -120.11])
        |> angledLine(angle = segAng(seg01), length = 78.33)
        |> line(end = [51.19, 48.97])
      part002 = startSketchOn(XZ)
        |> startProfile(at = [299.05, 231.45])
        |> xLine(length = -425.34, tag = $seg_what)
        |> yLine(length = -264.06)
        |> xLine(length = segLen(seg_what))
        |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [74.36, 130.4], tag = $seg01)').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        // Give time for overlays to populate
        await page.waitForTimeout(1000)

        const [line1, line3] = await Promise.all([
          u.getBoundingBox(`[data-overlay-index="${1}"]`),
          u.getBoundingBox(`[data-overlay-index="${3}"]`),
        ])

        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.up('Shift')
        await page.keyboard.down('Shift')
        await page.waitForTimeout(100)
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100)
        await page.keyboard.up('Shift')
        await page.waitForTimeout(100)
        await page
          .getByRole('button', {
            name: 'constraints: open menu',
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

        await pollEditorLinesSelectedLength(page, 2)
        const activeLinesContent = await page.locator('.cm-activeLine').all()
        await expect(activeLinesContent[0]).toHaveText(
          `|> line(end = [74.36, 130.4], tag = $seg01)`
        )
        await expect(activeLinesContent[1]).toHaveText(
          `  |> angledLineThatIntersects(angle = -57, offset = ${offset}, intersectTag = seg01)`
        )

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(5)
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
      test(`${constraint} - ${testName}`, async ({
        page,
        homePage,
        scene,
        cmdBar,
      }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-7.54, -26.74])
        |> line(end = [74.36, 130.4])
        |> line(end = [78.92, -120.11])
        |> line(end = [9.16, 77.79])
        |> line(end = [51.19, 48.97])
      part002 = startSketchOn(XZ)
        |> startProfile(at = [299.05, 231.45])
        |> xLine(length = -425.34, tag = $seg_what)
        |> yLine(length = -264.06)
        |> xLine(length = segLen(seg_what))
        |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1000, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [74.36, 130.4])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        // Wait for overlays to populate
        await page.waitForTimeout(1000)

        const [line1, line3] = await Promise.all([
          u.getBoundingBox(`[data-overlay-index="${1}"]`),
          u.getBoundingBox(`[data-overlay-index="${3}"]`),
        ])

        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100) // this wait is needed for webkit - not sure why
        await page.keyboard.up('Shift')
        await page
          .getByRole('button', {
            name: 'constraints: open menu',
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
          `|> line(end = [74.36, 130.4], tag = $seg01)`,
          `|> line(endAbsolute = [${value}])`,
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
        await expect(page.getByTestId('segment-overlay')).toHaveCount(5)
      })
    }
  })
  test.describe('Test ABS distance constraint', () => {
    const cases = [
      {
        testName: 'Add variable',
        addVariable: true,
        constraint: 'Absolute X',
        value: 'xDis001, 15',
      },
      {
        testName: 'No variable',
        addVariable: false,
        constraint: 'Absolute X',
        value: '15, 15',
      },
      {
        testName: 'Add variable',
        addVariable: true,
        constraint: 'Absolute Y',
        value: '15, yDis001',
      },
      {
        testName: 'No variable',
        addVariable: false,
        constraint: 'Absolute Y',
        value: '15, 15',
      },
    ] as const
    for (const { testName, addVariable, value, constraint } of cases) {
      test(`${constraint} - ${testName}`, async ({
        page,
        homePage,
        scene,
        cmdBar,
        toolbar,
      }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-15, -15])
        |> line(end = [20, 20])
        |> line(end = [10, 10])
        |> line(end = [5, -5])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 800 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [20, 20])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()
        await toolbar.closePane('code')

        // Wait for overlays to populate
        await page.waitForTimeout(1000)

        const [line3] = await Promise.all([
          u.getBoundingBox(`[data-overlay-index="${2}"]`),
        ])

        if (constraint === 'Absolute X') {
          await scene.clickYAxis()
        } else {
          await scene.clickXAxis()
        }
        await page.keyboard.down('Shift')
        await page.waitForTimeout(100)
        await page.mouse.click(line3.x, line3.y)
        await page.waitForTimeout(100)
        await page.keyboard.up('Shift')
        await page.waitForTimeout(100)
        await page
          .getByRole('button', {
            name: 'constraints: open menu',
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
        const codeAfter = [`|> line(endAbsolute = [${value}])`]

        await toolbar.openPane('code')
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
        value: 'turns::QUARTER_TURN - angle001',
      },
      {
        testName: 'No variable, selecting axis',
        addVariable: false,
        axisSelect: true,
        value: 'turns::QUARTER_TURN - 7',
      },
    ] as const
    for (const { testName, addVariable, value, axisSelect } of cases) {
      test(`${testName}`, async ({ page, homePage, scene, cmdBar }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-7.54, -26.74])
        |> line(end = [74.36, 130.4])
        |> line(end = [78.92, -120.11])
        |> line(end = [9.16, 77.79])
        |> line(end = [51.19, 48.97])
      part002 = startSketchOn(XZ)
        |> startProfile(at = [299.05, 231.45])
        |> xLine(length = -425.34, tag = $seg_what)
        |> yLine(length = -264.06)
        |> xLine(length = segLen(seg_what))
        |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [74.36, 130.4])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        // Wait for overlays to populate
        await page.waitForTimeout(1000)

        const [line1, line3] = await Promise.all([
          u.getBoundingBox(`[data-overlay-index="${1}"]`),
          u.getBoundingBox(`[data-overlay-index="${3}"]`),
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
            name: 'constraints: open menu',
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
          '|> line(end = [74.36, 130.4], tag = $seg01)',
          `|> angledLine(angle = ${value}, length = 78.33)`,
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
        await expect(page.getByTestId('segment-overlay')).toHaveCount(5)
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
      test(`${testName}`, async ({ page, homePage, scene, cmdBar }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-7.54, -26.74])
        |> line(end = [74.36, 130.4])
        |> line(end = [78.92, -120.11])
        |> line(end = [9.16, 77.79])
        |> line(end = [51.19, 48.97])
      part002 = startSketchOn(XZ)
        |> startProfile(at = [299.05, 231.45])
        |> xLine(length = -425.34, tag = $seg_what)
        |> yLine(length = -264.06)
        |> xLine(length = segLen(seg_what))
        |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1000, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [74.36, 130.4])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        // Wait for overlays to populate
        await page.waitForTimeout(1000)

        const line3 = await u.getBoundingBox(`[data-overlay-index="${3}"]`)

        await page.mouse.click(line3.x, line3.y)
        await page
          .getByRole('button', {
            name: 'constraints: open menu',
          })
          .click()
        await page.getByTestId('dropdown-constraint-' + constraint).click()

        if (!addVariable) {
          await page.getByTestId('create-new-variable-checkbox').click()
        }
        await page
          .getByRole('button', { name: 'Add constraining value' })
          .click()

        const [ang, len] = value.split(', ')
        const changedCode = `|> angledLine(angle = ${ang}, length = ${len})`
        await expect(page.locator('.cm-content')).toContainText(changedCode)
        // checking active assures the cursor is where it should be
        await expect(page.locator('.cm-activeLine')).toHaveText(changedCode)

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(5)
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
      test(`${testName}`, async ({
        context,
        homePage,
        page,
        editor,
        scene,
        cmdBar,
      }) => {
        // constants and locators
        const cmdBarKclInput = page
          .getByTestId('cmd-bar-arg-value')
          .getByRole('textbox')
        const cmdBarKclVariableNameInput =
          page.getByPlaceholder('Variable name')

        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
yo = 5
part001 = startSketchOn(XZ)
  |> startProfile(at = [-7.54, -26.74])
  |> line(end = [74.36, 130.4])
  |> line(end = [78.92, -120.11])
  |> line(end = [9.16, 77.79])
  |> line(end = [51.19, 48.97])
part002 = startSketchOn(XZ)
  |> startProfile(at = [299.05, 231.45])
  |> xLine(length = -425.34, tag = $seg_what)
  |> yLine(length = -264.06)
  |> xLine(length = segLen(seg_what))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await editor.scrollToText('line(end = [74.36, 130.4])', true)
        await page.getByText('line(end = [74.36, 130.4])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        const line3 = await u.getBoundingBox(`[data-overlay-index="${3}"]`)

        await page.mouse.click(line3.x, line3.y)
        await page
          .getByRole('button', {
            name: 'constraints: open menu',
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
        await page.waitForTimeout(500)
        const [ang, len] = value.split(', ')
        await cmdBar.continue()
        const changedCode = `|> angledLine(angle = ${ang}, length = ${len})`
        await editor.expectEditor.toContain(changedCode)

        // checking active assures the cursor is where it should be
        await expect(page.locator('.cm-activeLine')).toHaveText(changedCode)

        // checking the count of the overlays is a good proxy check that the client sketch scene is in a good state
        await expect(page.getByTestId('segment-overlay')).toHaveCount(5)
      })
    }
  })
  test.describe('Many segments - no modal constraints', () => {
    const cases = [
      {
        constraintName: 'Vertical',
        codeAfter: [
          `|> yLine(length = 130.4)`,
          `|> yLine(length = 77.79)`,
          `|> yLine(length = 48.97)`,
        ],
      },
      {
        codeAfter: [
          `|> xLine(length = 74.36)`,
          `|> xLine(length = 9.16)`,
          `|> xLine(length = 51.19)`,
        ],
        constraintName: 'Horizontal',
      },
    ] as const
    for (const { codeAfter, constraintName } of cases) {
      test(`${constraintName}`, async ({ page, homePage, scene, cmdBar }) => {
        await page.addInitScript(async (customCode) => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-7.54, -26.74])
        |> line(end = [74.36, 130.4])
        |> line(end = [78.92, -120.11])
        |> line(end = [9.16, 77.79])
        |> line(end = [51.19, 48.97])
      part002 = startSketchOn(XZ)
        |> startProfile(at = [299.05, 231.45])
        |> xLine(length = -425.34, tag = $seg_what)
        |> yLine(length = -264.06)
        |> xLine(length = segLen(seg_what))
        |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1000, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [74.36, 130.4])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        // Wait for overlays to populate
        await page.waitForTimeout(1000)

        const line1 = await u.getBoundingBox(`[data-overlay-index="${1}"]`)
        const line3 = await u.getBoundingBox(`[data-overlay-index="${3}"]`)
        const line4 = await u.getBoundingBox(`[data-overlay-index="${4}"]`)

        // select two segments by holding down shift
        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.mouse.click(line4.x, line4.y)
        await page.keyboard.up('Shift')

        // check actives lines
        await pollEditorLinesSelectedLength(page, codeAfter.length)
        const activeLinesContent = await page.locator('.cm-activeLine').all()

        const constraintMenuButton = page.getByRole('button', {
          name: 'constraints: open menu',
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
        codeAfter: `|> angledLine(angle = 83, length = segLen(seg01))`,
        constraintName: 'Equal Length',
      },
      {
        codeAfter: `|> angledLine(angle = segAng(seg01), length = 78.33)`,
        constraintName: 'Parallel',
      },
      {
        codeAfter: `|> line(endAbsolute = [segEndX(seg01), 61.34])`,
        constraintName: 'Vertically Align',
      },
      {
        codeAfter: `|> line(endAbsolute = [154.9, segEndY(seg01)])`,
        constraintName: 'Horizontally Align',
      },
    ] as const
    for (const { codeAfter, constraintName } of cases) {
      test(`${constraintName}`, async ({ page, homePage, scene, cmdBar }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-7.54, -26.74])
        |> line(end = [74.36, 130.4])
        |> line(end = [78.92, -120.11])
        |> line(end = [9.16, 77.79])
      part002 = startSketchOn(XZ)
        |> startProfile(at = [299.05, 231.45])
        |> xLine(length = -425.34, tag = $seg_what)
        |> yLine(length = -264.06)
        |> xLine(length = segLen(seg_what))
        |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1000, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [74.36, 130.4])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        // Wait for overlays to populate
        await page.waitForTimeout(1000)

        const line1 = await u.getBoundingBox(`[data-overlay-index="${1}"]`)
        const line3 = await u.getBoundingBox(`[data-overlay-index="${3}"]`)

        // select two segments by holding down shift
        await page.mouse.click(line1.x, line1.y)
        await page.keyboard.down('Shift')
        await page.mouse.click(line3.x, line3.y)
        await page.keyboard.up('Shift')
        const constraintMenuButton = page.getByRole('button', {
          name: 'constraints: open menu',
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
        await pollEditorLinesSelectedLength(page, 2)
        const activeLinesContent = await page.locator('.cm-activeLine').all()

        // check both cursors are where they should be after constraint is applied
        await expect(activeLinesContent[0]).toHaveText(
          '|> line(end = [74.36, 130.4], tag = $seg01)'
        )
        await expect(activeLinesContent[1]).toHaveText(codeAfter)
      })
    }
  })
  test.describe('Axis & segment - no modal constraints', () => {
    const cases = [
      {
        codeAfter: `|> line(endAbsolute = [154.9, turns::ZERO])`,
        axisClick: { x: 950, y: 250 },
        constraintName: 'Snap To X',
      },
      {
        codeAfter: `|> line(endAbsolute = [turns::ZERO, 61.34])`,
        axisClick: { x: 600, y: 150 },
        constraintName: 'Snap To Y',
      },
    ] as const
    for (const { codeAfter, constraintName, axisClick } of cases) {
      test(`${constraintName}`, async ({ page, homePage, scene, cmdBar }) => {
        await page.addInitScript(async () => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = in)
      yo = 5
      part001 = startSketchOn(XZ)
        |> startProfile(at = [-7.54, -26.74])
        |> line(end = [74.36, 130.4])
        |> line(end = [78.92, -120.11])
        |> line(end = [9.16, 77.79])
      part002 = startSketchOn(XZ)
        |> startProfile(at = [299.05, 231.45])
        |> xLine(length = -425.34, tag = $seg_what)
        |> yLine(length = -264.06)
        |> xLine(length = segLen(seg_what))
        |> line(endAbsolute = [profileStartX(%), profileStartY(%)])`
          )
        })
        const u = await getUtils(page)
        await page.setBodyDimensions({ width: 1200, height: 500 })

        await homePage.goToModelingScene()
        await scene.settled(cmdBar)

        await page.getByText('line(end = [74.36, 130.4])').click()
        await page.getByRole('button', { name: 'Edit Sketch' }).click()

        // Wait for overlays to populate
        await page.waitForTimeout(1000)

        const line3 = await u.getBoundingBox(`[data-overlay-index="${3}"]`)

        // select segment and axis by holding down shift
        await page.mouse.click(line3.x - 3, line3.y + 20)
        await page.waitForTimeout(100)
        await page.keyboard.down('Shift')
        await page.waitForTimeout(100)
        await page.mouse.click(axisClick.x, axisClick.y)
        await page.waitForTimeout(100)
        await page.keyboard.up('Shift')
        await page.waitForTimeout(100)
        const constraintMenuButton = page.getByRole('button', {
          name: 'constraints: open menu',
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
})
test.describe('Electron constraint tests', () => {
  test(
    'Able to double click label to set constraint',
    { tag: '@desktop' },
    async ({ page, context, homePage, scene, editor, toolbar, cmdBar }) => {
      await context.folderSetupFn(async (dir) => {
        const bracketDir = path.join(dir, 'test-sample')
        await fsp.mkdir(bracketDir, { recursive: true })
        await fsp.writeFile(
          path.join(bracketDir, 'main.kcl'),
          `@settings(defaultLengthUnit = in)
          part001 = startSketchOn(XY)
            |> startProfile(at = [4.83, 8.56])
            |> line(end = [15.1, 2.48])
            |> line(end = [3.15, -9.85], tag = $seg01)
            |> line(end = [-15.17, -4.1])
            |> angledLine(angle = segAng(seg01), length = 12.35)
            |> line(end = [-13.02, 10.03])
            |> close()
            |> extrude(length = 4)`,
          'utf-8'
        )
      })

      await test.step('setup test', async () => {
        await homePage.expectState({
          projectCards: [
            {
              title: 'test-sample',
              fileCount: 1,
            },
          ],
          sortBy: 'last-modified-desc',
        })
        await homePage.openProject('test-sample')
        await scene.settled(cmdBar)
      })

      async function clickOnFirstSegmentLabel() {
        const child = page
          .locator('.segment-length-label-text')
          .first()
          .locator('xpath=..')
        await child.dblclick()
      }

      await test.step('Double click to constrain', async () => {
        // Enter sketch edit mode via feature tree
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('Sketch', 0)
        await op.dblclick()
        await toolbar.closePane('feature-tree')

        await clickOnFirstSegmentLabel()
        await cmdBar.progressCmdBar()
        await editor.expectEditor.toContain('length001 = 15.3')
        await editor.expectEditor.toContain(
          '|> angledLine(angle = 9, length = length001)'
        )
      })

      await test.step('Double click again and expect failure', async () => {
        await clickOnFirstSegmentLabel()

        await expect(
          page.getByText('Unable to constrain the length of this segment')
        ).toBeVisible()

        await page.getByRole('button', { name: 'Exit Sketch' }).click()
      })
    }
  )
})
