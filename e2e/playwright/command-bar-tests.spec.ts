import path, { join } from 'path'
import { KCL_DEFAULT_LENGTH } from '@src/lib/constants'
import * as fsp from 'fs/promises'

import { executorInputPath, getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test.describe('Command bar tests', { tag: '@desktop' }, () => {
  test('Extrude from command bar selects extrude line after', async ({
    page,
    homePage,
    toolbar,
    cmdBar,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> xLine(length = -20)
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
    await page.getByText(`startProfile(at = [-10, -10])`).click()

    // Wait for the selection to register (TODO: we need a definitive way to wait for this)
    await page.waitForTimeout(200)

    await toolbar.extrudeButton.click()
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Extrude',
      currentArgKey: 'sketches',
      currentArgValue: '',
      headerArguments: {
        Profiles: '',
        Length: '5',
      },
      highlightedHeaderArg: 'Profiles',
    })
    await cmdBar.progressCmdBar()
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'review',
      commandName: 'Extrude',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
      },
    })
    await cmdBar.progressCmdBar()
    await expect(page.locator('.cm-activeLine')).toHaveText(
      `extrude001 = extrude(sketch001, length = ${KCL_DEFAULT_LENGTH})`
    )
  })

  test('Command bar can change a setting, and switch back and forth between arguments', async ({
    page,
    homePage,
    toolbar,
    scene,
    cmdBar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

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

    await expect(toolbar.startSketchBtn).not.toBeDisabled()

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

    await test.step(`Pressing backspace in the command selection step does not dismiss`, async () => {
      await page.keyboard.press('Backspace')
      await expect(cmdSearchBar).toBeVisible()
      await expect(cmdSearchBar).toBeFocused()
    })

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

  test('Command bar keybinding works from code editor and can change a setting', async ({
    page,
    homePage,
    toolbar,
    scene,
    cmdBar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // FIXME: No KCL code, unable to wait for engine execution
    await page.waitForTimeout(10000)

    await expect(toolbar.startSketchBtn).not.toBeDisabled()

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
    await expect(page.getByRole('option', { name: 'system' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set theme to "system" as a user default`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
  })

  test('Can extrude from the command bar', async ({
    page,
    homePage,
    cmdBar,
    scene,
    editor,
  }) => {
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `distance = sqrt(20)
    sketch001 = startSketchOn(XZ)
    |> startProfile(at = [-6.95, 10.98])
    |> line(end = [25.1, 0.41])
    |> line(end = [0.73, -20.93])
    |> line(end = [-23.44, 0.52])
    |> close()
        `
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    let cmdSearchBar = page.getByPlaceholder('Search commands')
    await page.keyboard.press('ControlOrMeta+K')
    await expect(cmdSearchBar).toBeVisible()

    // Search for extrude command and choose it
    await cmdBar.cmdOptions.getByText('Extrude').click()

    // Assert that we're on the selection step
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Extrude',
      currentArgKey: 'sketches',
      currentArgValue: '',
      headerArguments: {
        Profiles: '',
        Length: '5',
      },
      highlightedHeaderArg: 'Profiles',
    })
    // Select a face
    await editor.selectText('startProfile(at = [-6.95, 10.98])')
    await cmdBar.progressCmdBar()

    // Assert that we're on the distance step
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Extrude',
      currentArgKey: 'length',
      currentArgValue: '5',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
      },
      highlightedHeaderArg: 'length',
    })

    // Assert that the an alternative variable name is chosen,
    // since the default variable name is already in use (distance)
    await cmdBar.variableCheckbox.click()
    await expect(page.getByPlaceholder('Variable name')).toHaveValue(
      'length001'
    )
    await cmdBar.progressCmdBar()

    // Review step and argument hotkeys
    await cmdBar.expectState({
      stage: 'review',
      commandName: 'Extrude',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
      },
    })
    await page.keyboard.press('Meta+Backspace')

    // Assert we're back on the distance step
    await expect(
      page.getByRole('button', { name: 'length', exact: false })
    ).toBeDisabled()

    await cmdBar.progressCmdBar()

    // Add optional arg
    await cmdBar.expectState({
      stage: 'review',
      commandName: 'Extrude',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
      },
    })
    await cmdBar.clickOptionalArgument('bidirectionalLength')
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Extrude',
      currentArgKey: 'bidirectionalLength',
      currentArgValue: '',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
        BidirectionalLength: '',
      },
      highlightedHeaderArg: 'bidirectionalLength',
    })
    await page.keyboard.type('10') // Set bidirectional length
    await cmdBar.progressCmdBar()
    await cmdBar.expectState({
      stage: 'review',
      commandName: 'Extrude',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
        BidirectionalLength: '10',
      },
    })

    // Clear optional arg
    await page.getByRole('button', { name: 'BidirectionalLength' }).click()
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Extrude',
      currentArgKey: 'bidirectionalLength',
      currentArgValue: '10',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
        BidirectionalLength: '10',
      },
      highlightedHeaderArg: 'bidirectionalLength',
    })
    await cmdBar.clearNonRequiredButton.click()
    await cmdBar.expectState({
      stage: 'review',
      commandName: 'Extrude',
      headerArguments: {
        Profiles: '1 profile',
        Length: '5',
      },
    })

    await cmdBar.progressCmdBar()
    await scene.settled(cmdBar)
    await editor.expectEditor.toContain(
      'extrude001 = extrude(sketch001, length = length001)'
    )
  })

  test('Can switch between sketch tools via command bar', async ({
    page,
    homePage,
    scene,
    cmdBar,
    toolbar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    const sketchButton = toolbar.startSketchBtn
    const cmdBarButton = page.getByRole('button', { name: 'Commands' })
    const rectangleToolCommand = page.getByRole('option', {
      name: 'rectangle',
    })
    const rectangleToolButton = page.getByRole('button', {
      name: 'rectangle Corner rectangle',
    })
    const lineToolCommand = page.getByRole('option', {
      name: 'line Line Start drawing',
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
    await toolbar.waitUntilSketchingReady()

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
    })

    await test.step(`Submit the command`, async () => {
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Import file from URL',
        currentArgKey: 'method',
        currentArgValue: '',
        headerArguments: {
          Method: '',
          Name: 'main.kcl',
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
          Name: 'main.kcl',
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
    })

    await test.step(`Submit the command`, async () => {
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Import file from URL',
        currentArgKey: 'method',
        currentArgValue: '',
        headerArguments: {
          Method: '',
          Name: 'main.kcl',
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
          Name: 'main.kcl',
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
          Name: 'main.kcl',
          Code: '1 line',
        },
      })
      await cmdBar.progressCmdBar()
    })

    await test.step(`Ensure we created the project and are in the modeling scene`, async () => {
      await editor.expectEditor.toContain('extrusionDistance = 12')
      await toolbar.openPane(DefaultLayoutPaneID.Files)
      await toolbar.expectFileTreeState(['main-1.kcl', 'main.kcl'])
    })
  })

  test(`Can add and edit a named parameter or constant`, async ({
    page,
    homePage,
    context,
    cmdBar,
    scene,
    editor,
  }) => {
    const projectName = 'test'
    const beforeKclCode = `a = 5
b = a * a
c = 3 + a
theta = 45deg
export exported = 1
`
    await context.folderSetupFn(async (dir) => {
      const testProject = join(dir, projectName)
      await fsp.mkdir(testProject, { recursive: true })
      await fsp.writeFile(join(testProject, 'main.kcl'), beforeKclCode, 'utf-8')
    })
    await homePage.openProject(projectName)
    // TODO: you probably shouldn't need an engine connection to add a parameter,
    // but you do because all modeling commands have that requirement
    // Don't use scene.settled here
    await expect(scene.startEditSketchBtn).toBeEnabled({ timeout: 15_000 })

    await test.step(`Create a parameter via command bar`, async () => {
      await cmdBar.cmdBarOpenBtn.click()
      await cmdBar.chooseCommand('create parameter')
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Create parameter',
        currentArgKey: 'value',
        currentArgValue: '5',
        headerArguments: {
          Value: '',
        },
        highlightedHeaderArg: 'value',
      })
      await cmdBar.argumentInput.locator('[contenteditable]').fill(`b - 5`)
      // TODO: we have no loading indicator for the KCL argument input calculation
      await page.waitForTimeout(100)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'commandBarClosed',
      })
    })

    await editor.expectEditor.toContain(
      `a = 5b = a * amyParameter001 = b - 5c = 3 + a`
    )

    const newValue = `2 * b + a`

    await test.step(`Edit the parameter via command bar`, async () => {
      // TODO: make the command palette command registration more static, and the enabled state more dynamic
      // so that we can just open the command palette and know all commands will be there.
      await expect(scene.startEditSketchBtn).toBeEnabled()

      await cmdBar.cmdBarOpenBtn.click()
      await cmdBar.chooseCommand('edit parameter')
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Edit parameter',
        currentArgKey: 'Name',
        currentArgValue: '',
        headerArguments: {
          Name: '',
          Value: '',
        },
        highlightedHeaderArg: 'Name',
      })
      await cmdBar
        .selectOption({
          name: 'myParameter001',
        })
        .click()
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Edit parameter',
        currentArgKey: 'value',
        currentArgValue: 'b - 5',
        headerArguments: {
          Name: 'myParameter001',
          Value: '',
        },
        highlightedHeaderArg: 'value',
      })
      await cmdBar.argumentInput.locator('[contenteditable]').fill(newValue)
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Edit parameter',
        headerArguments: {
          Name: 'myParameter001',
          // KCL inputs show the *computed* value, not the input value, in the command palette header
          Value: '55',
        },
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'commandBarClosed',
      })
    })
    await test.step(`Edit a parameter with explicit units via command bar`, async () => {
      await cmdBar.cmdBarOpenBtn.click()
      await cmdBar.chooseCommand('edit parameter')
      await cmdBar
        .selectOption({
          name: 'theta',
        })
        .click()
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Edit parameter',
        currentArgKey: 'value',
        currentArgValue: '45deg',
        headerArguments: {
          Name: 'theta',
          Value: '',
        },
        highlightedHeaderArg: 'value',
      })
      await cmdBar.argumentInput
        .locator('[contenteditable]')
        .fill('45deg + 1deg')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Edit parameter',
        headerArguments: {
          Name: 'theta',
          Value: '46deg',
        },
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'commandBarClosed',
      })
    })
    await test.step(`Edit an exported parameter via command bar`, async () => {
      await cmdBar.cmdBarOpenBtn.click()
      await cmdBar.chooseCommand('edit parameter')
      await cmdBar
        .selectOption({
          name: 'exported',
        })
        .click()
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Edit parameter',
        currentArgKey: 'value',
        currentArgValue: '1',
        headerArguments: {
          Name: 'exported',
          Value: '',
        },
        highlightedHeaderArg: 'value',
      })
      await cmdBar.argumentInput.locator('[contenteditable]').fill('2')
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        commandName: 'Edit parameter',
        headerArguments: {
          Name: 'exported',
          Value: '2',
        },
      })
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'commandBarClosed',
      })
    })

    await editor.expectEditor.toContain(
      `a = 5b = a * a
myParameter001 = ${newValue}
c = 3 + a
theta = 45deg + 1deg
export exported = 2`,
      { shouldNormalise: true }
    )
  })

  test('Command palette can be opened via query parameter - desktop', async ({
    page,
    homePage,
    cmdBar,
  }) => {
    await page.goto(`${page.url()}/?cmd=app.theme&groupId=settings`)
    await homePage.expectState({
      projectCards: [],
      sortBy: 'last-modified-desc',
    })
    await cmdBar.expectState({
      stage: 'arguments',
      commandName: 'Settings · app · theme',
      currentArgKey: 'value',
      currentArgValue: '',
      headerArguments: {
        Level: 'user',
        Value: '',
      },
      highlightedHeaderArg: 'value',
    })
  })

  test(
    'Command palette can be opened via query parameter - web',
    { tag: '@web' },
    async ({ page, cmdBar }) => {
      await page.goto(`${page.url()}/?cmd=app.theme&groupId=settings`)
      await cmdBar.expectCommandName('Settings · app · theme')
      await cmdBar.expectState({
        stage: 'arguments',
        commandName: 'Settings · app · theme',
        currentArgKey: 'value',
        currentArgValue: '',
        headerArguments: {
          Level: 'user',
          Value: '',
        },
        highlightedHeaderArg: 'value',
      })
    }
  )
})
