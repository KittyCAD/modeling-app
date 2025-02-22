import { test, expect } from './zoo-test'
import * as fsp from 'fs/promises'
import { executorInputPath, getUtils } from './test-utils'
import { KCL_DEFAULT_LENGTH } from 'lib/constants'
import path from 'path'

test.describe('Command bar tests', { tag: ['@skipWin'] }, () => {
  test('Extrude from command bar selects extrude line after', async ({
    page,
    homePage,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XY')
  |> startProfileAt([-10, -10], %)
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> xLine(-20, %)
  |> close()
    `
      )
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    // Click the line of code for xLine.
    await page.getByText(`close()`).click() // TODO remove this and reinstate // await topHorzSegmentClick()
    await page.waitForTimeout(100)

    await page.getByRole('button', { name: 'Extrude' }).click()
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    await page.keyboard.press('Enter')
    await page.waitForTimeout(200)
    await expect(page.locator('.cm-activeLine')).toHaveText(
      `extrude001 = extrude(sketch001, length = ${KCL_DEFAULT_LENGTH})`
    )
  })

  // TODO: fix this test after the electron migration
  test.fixme('Fillet from command bar', async ({ page, homePage }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn('XY')
    |> startProfileAt([-5, -5], %)
    |> line(end = [0, 10])
    |> line(end = [10, 0])
    |> line(end = [0, -10])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
  extrude001 = extrude(sketch001, length = -10)`
      )
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.closeDebugPanel()

    const selectSegment = () => page.getByText(`line(end = [0, -10])`).click()

    await selectSegment()
    await page.waitForTimeout(100)
    await page.getByRole('button', { name: 'Fillet' }).click()
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter') // skip selection
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter') // accept default radius
    await page.waitForTimeout(100)
    await page.keyboard.press('Enter') // submit
    await page.waitForTimeout(100)
    await expect(page.locator('.cm-activeLine')).toContainText(
      `fillet( radius = ${KCL_DEFAULT_LENGTH}, tags = [seg01] )`
    )
  })

  test('Command bar can change a setting, and switch back and forth between arguments', async ({
    page,
    homePage,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    const commandName = 'debug panel'
    const commandOption = page.getByRole('option', {
      name: commandName,
      exact: false,
    })
    const commandLevelArgButton = page.getByRole('button', { name: 'level' })
    const commandThemeArgButton = page.getByRole('button', { name: 'value' })
    const paneSelector = page.getByRole('button', { name: 'debug panel' })
    // This selector changes after we set the setting
    let commandOptionInput = page.getByPlaceholder('On')

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
    await page.keyboard.press('ControlOrMeta+K')
    await expect(cmdSearchBar).toBeVisible()
    await expect(cmdSearchBar).toBeFocused()

    // Try typing in the command bar
    await cmdSearchBar.fill(commandName)
    await expect(commandOption).toBeVisible()
    await commandOption.click()
    const toggleInput = page.getByPlaceholder('On')
    await expect(toggleInput).toBeVisible()
    await expect(toggleInput).toBeFocused()
    // Select On
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'Off' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set show debug panel to "false" for this project`)
    ).toBeVisible()
    // Check that the visibility changed
    await expect(paneSelector).not.toBeVisible()

    commandOptionInput = page.locator('[id="option-input"]')

    // Test case for https://github.com/KittyCAD/modeling-app/issues/2882
    await commandBarButton.click()
    await cmdSearchBar.focus()
    await cmdSearchBar.fill(commandName)
    await commandOption.click()
    await expect(commandThemeArgButton).toBeDisabled()
    await commandOptionInput.focus()
    await commandOptionInput.fill('on')
    await commandLevelArgButton.click()
    await expect(commandLevelArgButton).toBeDisabled()

    // Test case for https://github.com/KittyCAD/modeling-app/issues/2881
    await commandThemeArgButton.click()
    await expect(commandThemeArgButton).toBeDisabled()
    await expect(commandLevelArgButton).toHaveText('level: project')
  })

  test(
    'Command bar keybinding works from code editor and can change a setting',
    { tag: ['@skipWin'] },
    async ({ page, homePage }) => {
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()

      // FIXME: No KCL code, unable to wait for engine execution
      await page.waitForTimeout(10000)

      await expect(
        page.getByRole('button', { name: 'Start Sketch' })
      ).not.toBeDisabled()

      // Put the cursor in the code editor
      await page.locator('.cm-content').click()

      // Now try the same, but with the keyboard shortcut, check focus
      await page.keyboard.press('ControlOrMeta+K')

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
      const themeInput = page.getByPlaceholder('dark')
      await expect(themeInput).toBeVisible()
      await expect(themeInput).toBeFocused()
      // Select dark theme
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await expect(
        page.getByRole('option', { name: 'system' })
      ).toHaveAttribute('data-headlessui-state', 'active')
      await page.keyboard.press('Enter')

      // Check the toast appeared
      await expect(
        page.getByText(`Set theme to "system" as a user default`)
      ).toBeVisible()
      // Check that the theme changed
      await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
    }
  )

  test('Can extrude from the command bar', async ({ page, homePage }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `distance = sqrt(20)
    sketch001 = startSketchOn('XZ')
    |> startProfileAt([-6.95, 10.98], %)
    |> line(end = [25.1, 0.41])
    |> line(end = [0.73, -20.93])
    |> line(end = [-23.44, 0.52])
    |> close()
        `
      )
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await homePage.goToModelingScene()

    // Make sure the stream is up
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()
    await u.clearCommandLogs()
    await page.getByRole('button', { name: 'Extrude' }).isEnabled()

    let cmdSearchBar = page.getByPlaceholder('Search commands')
    await page.keyboard.press('ControlOrMeta+K')
    await expect(cmdSearchBar).toBeVisible()

    // Search for extrude command and choose it
    await page.getByTestId('cmd-bar-extrude').click()

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

    await u.waitForCmdReceive('extrude')

    await expect(page.locator('.cm-content')).toContainText(
      'extrude001 = extrude(sketch001, length = distance001)'
    )
  })

  test('Can switch between sketch tools via command bar', async ({
    page,
    homePage,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()

    const sketchButton = page.getByRole('button', { name: 'Start Sketch' })
    const cmdBarButton = page.getByRole('button', { name: 'Commands' })
    const rectangleToolCommand = page.getByRole('option', {
      name: 'rectangle',
    })
    const rectangleToolButton = page.getByRole('button', {
      name: 'rectangle Corner rectangle',
    })
    const lineToolCommand = page.getByRole('option', {
      name: 'Line',
    })
    const lineToolButton = page.getByRole('button', {
      name: 'line Line',
      exact: true,
    })
    const arcToolCommand = page.getByRole('option', { name: 'Tangential Arc' })
    const arcToolButton = page.getByRole('button', {
      name: 'arc Tangential Arc',
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

  test(`Reacts to query param to open "import from URL" command`, async ({
    page,
    cmdBar,
    editor,
    homePage,
  }) => {
    await test.step(`Prepare and navigate to home page with query params`, async () => {
      const targetURL = `?create-file&name=test&units=mm&code=ZXh0cnVzaW9uRGlzdGFuY2UgPSAxMg%3D%3D&ask-open-desktop`
      await homePage.expectState({
        projectCards: [],
        sortBy: 'last-modified-desc',
      })
      await page.goto(page.url() + targetURL)
      expect(page.url()).toContain(targetURL)
    })

    await test.step(`Submit the command`, async () => {
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Import file from URL',
        currentArgKey: 'method',
        currentArgValue: '',
        headerArguments: {
          Method: '',
          Name: 'test',
          Code: '1 line',
        },
        highlightedHeaderArg: 'method',
      })
      await cmdBar.selectOption({ name: 'New Project' }).click()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Import file from URL',
        headerArguments: {
          Method: 'New project',
          Name: 'test',
          Code: '1 line',
        },
      })
      await cmdBar.progressCmdBar()
    })

    await test.step(`Ensure we created the project and are in the modeling scene`, async () => {
      await editor.expectEditor.toContain('extrusionDistance = 12')
    })
  })

  test(`"import from URL" can add to existing project`, async ({
    page,
    cmdBar,
    editor,
    homePage,
    toolbar,
    context,
  }) => {
    await context.folderSetupFn(async (dir) => {
      const testProjectDir = path.join(dir, 'testProjectDir')
      await Promise.all([fsp.mkdir(testProjectDir, { recursive: true })])
      await Promise.all([
        fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          path.join(testProjectDir, 'main.kcl')
        ),
      ])
    })
    await test.step(`Prepare and navigate to home page with query params`, async () => {
      const targetURL = `?create-file&name=test&units=mm&code=ZXh0cnVzaW9uRGlzdGFuY2UgPSAxMg%3D%3D&ask-open-desktop`
      await homePage.expectState({
        projectCards: [
          {
            fileCount: 1,
            title: 'testProjectDir',
          },
        ],
        sortBy: 'last-modified-desc',
      })
      await page.goto(page.url() + targetURL)
      expect(page.url()).toContain(targetURL)
    })

    await test.step(`Submit the command`, async () => {
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Import file from URL',
        currentArgKey: 'method',
        currentArgValue: '',
        headerArguments: {
          Method: '',
          Name: 'test',
          Code: '1 line',
        },
        highlightedHeaderArg: 'method',
      })
      await cmdBar.selectOption({ name: 'Existing Project' }).click()
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Import file from URL',
        currentArgKey: 'projectName',
        currentArgValue: '',
        headerArguments: {
          Method: 'Existing project',
          Name: 'test',
          ProjectName: '',
          Code: '1 line',
        },
        highlightedHeaderArg: 'projectName',
      })
      await cmdBar.selectOption({ name: 'testProjectDir' }).click()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Import file from URL',
        headerArguments: {
          Method: 'Existing project',
          ProjectName: 'testProjectDir',
          Name: 'test',
          Code: '1 line',
        },
      })
      await cmdBar.progressCmdBar()
    })

    await test.step(`Ensure we created the project and are in the modeling scene`, async () => {
      await editor.expectEditor.toContain('extrusionDistance = 12')
      await toolbar.openPane('files')
      await toolbar.expectFileTreeState(['main.kcl', 'test.kcl'])
    })
  })
})
