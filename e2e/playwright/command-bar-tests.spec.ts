import { executorInputPath } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import * as fsp from 'fs/promises'
import path, { join } from 'path'

test.describe('Command bar tests', { tag: '@desktop' }, () => {
  test('Command bar can change a setting, and switch back and forth between arguments', async ({
    page,
    homePage,
    toolbar,
    scene,
    cmdBar,
  }) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.goToModelingScene()
    await scene.settled()

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

    // Reopen through the in-app control. The dedicated test below owns the
    // Mod+K coverage and starts from an explicitly focused editor.
    await commandBarButton.click()
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
      page.getByText(`Set show panel to "false" for this project`)
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
    await expect(commandLevelArgButton).toHaveText(/^Level:\s+project$/)
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
    await scene.settled()

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
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
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
    cmdBar,
    scene,
    editor,
    folderSetupFn,
  }) => {
    const projectName = 'test'
    const beforeKclCode = `a = 5
b = a * a
c = 3 + a
theta = 45deg
export exported = 1
`
    await folderSetupFn(async (dir) => {
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
      await expect(page).toHaveURL(
        (url) =>
          !url.searchParams.has('cmd') && !url.searchParams.has('groupId'),
        { timeout: 15_000 }
      )
      await cmdBar.expectCommandName('Settings · app · theme')
    }
  )

  test('Command bar steps back through optional and required Export arguments', async ({
    page,
    homePage,
    scene,
    cmdBar,
    modelingDialog,
  }) => {
    await page.addInitScript(() => {
      localStorage.setItem(
        'persistCode',
        `@settings(kclVersion = 3.0)
sketch001 = sketch(on = XY) {
  circle001 = circle(start = [var 5mm, var 0mm], center = [var 0mm, var 0mm])
}
region001 = region(segments = [sketch001.circle001])
extrude001 = extrude(region001, length = 10mm)`
      )
    })
    await homePage.goToModelingScene()
    await scene.settled()
    await cmdBar.openCmdBar()
    await cmdBar.cmdOptions.getByText('Export', { exact: true }).click()
    await expect
      .poll(() => cmdBar.getState())
      .toMatchObject({ stage: 'arguments', currentArgKey: 'type' })
    await cmdBar.selectOption({ name: 'STL', exact: true }).click()
    await expect
      .poll(() => cmdBar.getState())
      .toMatchObject({ stage: 'review' })
    await expect(modelingDialog.locator).not.toBeAttached()
    await page.keyboard.press('Meta+Backspace')
    await expect
      .poll(() => cmdBar.getState())
      .toMatchObject({ stage: 'arguments', currentArgKey: 'Scale' })
    await cmdBar.clearNonRequiredButton.click()
    await expect
      .poll(() => cmdBar.getState())
      .toMatchObject({ stage: 'review' })
    const review = await cmdBar.getState()
    if (review.stage !== 'review') throw new Error('Expected Export review')

    await cmdBar.clickOptionalArgument('scale')
    await expect
      .poll(() => cmdBar.getState())
      .toMatchObject({
        stage: 'arguments',
        currentArgKey: 'Scale',
      })
    // Leave the optional argument unconfirmed, then traverse both kinds of fields.
    for (const name of ['Up', 'storage', 'type']) {
      await cmdBar.stepBackButton.click()
      await expect
        .poll(() => cmdBar.getState())
        .toMatchObject({
          stage: 'arguments',
          currentArgKey: name,
          headerArguments: review.headerArguments,
        })
    }
    await cmdBar.stepBackButton.click()
    await cmdBar.expectState({ stage: 'commandBarClosed' })
  })
})
