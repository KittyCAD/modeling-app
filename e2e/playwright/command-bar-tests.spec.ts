import { test, expect } from '@playwright/test'

import { getUtils, setup, tearDown } from './test-utils'
import { KCL_DEFAULT_LENGTH } from 'lib/constants'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Command bar tests', () => {
  test('Extrude from command bar selects extrude line after', async ({
    page,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
    |> startProfileAt([-10, -10], %)
    |> line([20, 0], %)
    |> line([0, 20], %)
    |> xLine(-20, %)
    |> close(%)
      `
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Click the line of code for xLine.
    await page.getByText(`close(%)`).click() // TODO remove this and reinstate // await topHorzSegmentClick()
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'Extrude' }).click()
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      `const extrude001 = extrude(${KCL_DEFAULT_LENGTH}, sketch001)`
    )
  })

  test('Fillet from command bar', async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('XY')
  |> startProfileAt([-5, -5], %)
  |> line([0, 10], %)
  |> line([10, 0], %)
  |> line([0, -10], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
const extrude001 = extrude(-10, sketch001)`
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1000, height: 500 })
    await u.waitForAuthSkipAppStart()
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const selectSegment = () => page.getByText(`line([0, -10], %)`).click()

    await selectSegment()
    await page.waitForTimeout(100)
    await page.getByRole('button', { name: 'Fillet' }).click()
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toContainText(
      `fillet({ radius: ${KCL_DEFAULT_LENGTH}, tags: [seg01] }, %)`
    )
  })

  test('Command bar can change a setting, and switch back and forth between arguments', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    const themeOption = page.getByRole('option', {
      name: 'theme',
      exact: false,
    })
    const commandLevelArgButton = page.getByRole('button', { name: 'level' })
    const commandThemeArgButton = page.getByRole('button', { name: 'value' })
    // This selector changes after we set the setting
    let commandOptionInput = page.getByPlaceholder('Select an option')

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    // First try opening the command bar and closing it
    await page
      .getByRole('button', { name: 'Commands', exact: false })
      .or(page.getByRole('button', { name: '⌘K' }))
      .click()

    await expect(cmdSearchBar).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(cmdSearchBar).not.toBeVisible()

    // Now try the same, but with the keyboard shortcut, check focus
    await page.keyboard.press('Meta+K')
    await expect(cmdSearchBar).toBeVisible()
    await expect(cmdSearchBar).toBeFocused()

    // Try typing in the command bar
    await cmdSearchBar.fill('theme')
    await expect(themeOption).toBeVisible()
    await themeOption.click()
    const themeInput = page.getByPlaceholder('Select an option')
    await expect(themeInput).toBeVisible()
    await expect(themeInput).toBeFocused()
    // Select dark theme
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'system' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set theme to "system" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)

    commandOptionInput = page.getByPlaceholder('system')

    // Test case for https://github.com/KittyCAD/modeling-app/issues/2882
    await commandBarButton.click()
    await cmdSearchBar.focus()
    await cmdSearchBar.fill('theme')
    await themeOption.click()
    await expect(commandThemeArgButton).toBeDisabled()
    await commandOptionInput.focus()
    await commandOptionInput.fill('lig')
    await commandLevelArgButton.click()
    await expect(commandLevelArgButton).toBeDisabled()

    // Test case for https://github.com/KittyCAD/modeling-app/issues/2881
    await commandThemeArgButton.click()
    await expect(commandThemeArgButton).toBeDisabled()
    await expect(commandLevelArgButton).toHaveText('level: project')
  })

  test('Command bar keybinding works from code editor and can change a setting', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    // Put the cursor in the code editor
    await page.locator('.cm-content').click()

    // Now try the same, but with the keyboard shortcut, check focus
    await page.keyboard.press('Meta+K')

    let cmdSearchBar = page.getByPlaceholder('Search commands')
    await expect(cmdSearchBar).toBeVisible()
    await expect(cmdSearchBar).toBeFocused()

    // Try typing in the command bar
    await cmdSearchBar.fill('theme')
    const themeOption = page.getByRole('option', {
      name: 'Settings · app · theme',
    })
    await expect(themeOption).toBeVisible()
    await themeOption.click()
    const themeInput = page.getByPlaceholder('Select an option')
    await expect(themeInput).toBeVisible()
    await expect(themeInput).toBeFocused()
    // Select dark theme
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'system' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set theme to "system" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
  })

  test('Can extrude from the command bar', async ({ page }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const distance = sqrt(20)
      const sketch001 = startSketchOn('XZ')
      |> startProfileAt([-6.95, 10.98], %)
      |> line([25.1, 0.41], %)
      |> line([0.73, -20.93], %)
      |> line([-23.44, 0.52], %)
      |> close(%)
          `
      )
    })

    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // Make sure the stream is up
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Extrude' }).isEnabled()

    let cmdSearchBar = page.getByPlaceholder('Search commands')
    await page.keyboard.press('Meta+K')
    await expect(cmdSearchBar).toBeVisible()

    // Search for extrude command and choose it
    await page.getByRole('option', { name: 'Extrude' }).click()

    // Assert that we're on the selection step
    await expect(page.getByRole('button', { name: 'selection' })).toBeDisabled()
    // Select a face
    await page.mouse.move(700, 200)
    await page.mouse.click(700, 200)

    // Assert that we're on the distance step
    await expect(
      page.getByRole('button', { name: 'distance', exact: false })
    ).toBeDisabled()

    // Assert that the an alternative variable name is chosen,
    // since the default variable name is already in use (distance)
    await page.getByRole('button', { name: 'Create new variable' }).click()
    await expect(page.getByPlaceholder('Variable name')).toHaveValue(
      'distance001'
    )

    const continueButton = page.getByRole('button', { name: 'Continue' })
    const submitButton = page.getByRole('button', { name: 'Submit command' })
    await continueButton.click()

    // Review step and argument hotkeys
    await expect(submitButton).toBeEnabled()
    await expect(submitButton).toBeFocused()
    await submitButton.press('Backspace')

    // Assert we're back on the distance step
    await expect(
      page.getByRole('button', { name: 'distance', exact: false })
    ).toBeDisabled()

    await continueButton.click()
    await submitButton.click()

    // Check that the code was updated
    await u.waitForCmdReceive('extrude')
    // Unfortunately this indentation seems to matter for the test
    await expect(page.locator('.cm-content')).toHaveText(
      `const distance = sqrt(20)
const distance001 = ${KCL_DEFAULT_LENGTH}
const sketch001 = startSketchOn('XZ')
    |> startProfileAt([-6.95, 10.98], %)
    |> line([25.1, 0.41], %)
    |> line([0.73, -20.93], %)
    |> line([-23.44, 0.52], %)
    |> close(%)
const extrude001 = extrude(distance001, sketch001)`.replace(
        /(\r\n|\n|\r)/gm,
        ''
      ) // remove newlines
    )
  })

  test('Can switch between sketch tools via command bar', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    const sketchButton = page.getByRole('button', { name: 'Start Sketch' })
    const cmdBarButton = page.getByRole('button', { name: 'Commands' })
    const rectangleToolCommand = page.getByRole('option', {
      name: 'rectangle',
    })
    const rectangleToolButton = page.getByRole('button', {
      name: 'Corner rectangle',
      exact: true,
    })
    const lineToolCommand = page.getByRole('option', {
      name: 'Line',
    })
    const lineToolButton = page.getByRole('button', {
      name: 'Line',
      exact: true,
    })
    const arcToolCommand = page.getByRole('option', { name: 'Tangential Arc' })
    const arcToolButton = page.getByRole('button', {
      name: 'Tangential Arc',
      exact: true,
    })

    // Start a sketch
    await sketchButton.click()
    await page.mouse.click(700, 200)

    // Switch between sketch tools via the command bar
    await expect(lineToolButton).toHaveAttribute('aria-pressed', 'true')
    await cmdBarButton.click()
    await rectangleToolCommand.click()
    await expect(rectangleToolButton).toHaveAttribute('aria-pressed', 'true')
    await cmdBarButton.click()
    await lineToolCommand.click()
    await expect(lineToolButton).toHaveAttribute('aria-pressed', 'true')

    // Click in the scene a couple times to draw a line
    // so tangential arc is valid
    await page.mouse.click(700, 200)
    await page.mouse.move(700, 300, { steps: 5 })
    await page.mouse.click(700, 300)

    // switch to tangential arc via command bar
    await cmdBarButton.click()
    await arcToolCommand.click()
    await expect(arcToolButton).toHaveAttribute('aria-pressed', 'true')
  })
})
