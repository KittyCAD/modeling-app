import path from 'path'
import { DEFAULT_PROJECT_KCL_FILE, REGEXP_UUIDV4 } from '@src/lib/constants'
import nodeFs from 'fs/promises'
import { NIL as uuidNIL } from 'uuid'

import {
  createProject,
  executorInputPath,
  getUtils,
  isOutOfViewInScrollContainer,
  runningOnWindows,
  closeOnboardingModalIfPresent,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

test(
  'projects reload if a new one is created, deleted, or renamed externally',
  { tag: ['@web', '@desktop', '@macos', '@windows'] },
  async ({ context, page, fs, folderSetupFn }, testInfo) => {
    const appLogo = page.getByTestId('app-logo')
    await expect(appLogo).toBeVisible()

    let targetDir = ''
    let externalCreatedProjectName = 'external-created-project-name'

    await folderSetupFn(async (dir) => {
      targetDir = dir
      const myDir = path.join(dir, externalCreatedProjectName)
      await fs.mkdir(myDir, { recursive: true })
      await fs.writeFile(
        path.join(myDir, DEFAULT_PROJECT_KCL_FILE),
        'meaningless nonsense here'
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    const projectLinks = page.getByTestId('project-link')
    await projectLinks.first().waitFor()
    await expect(projectLinks).toContainText(externalCreatedProjectName)

    await fs.rename(
      path.join(targetDir, externalCreatedProjectName),
      path.join(targetDir, externalCreatedProjectName + '1')
    )

    externalCreatedProjectName += '1'
    await expect(projectLinks).toContainText(externalCreatedProjectName)
  }
)

test(
  'click help/keybindings from home page',
  { tag: ['@web', '@desktop'] },
  async ({ page }, testInfo) => {
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    // click ? button
    await page.getByTestId('help-button').click()
    await expect(page.getByTestId('keybindings-button')).toBeVisible()
    // Click keyboard shortcuts button.
    await page.getByTestId('keybindings-button').click()
    // Make sure the keyboard shortcuts modal is visible.
    await expect(page.getByText('Enter Sketch Mode')).toBeVisible()
  }
)

test(
  'click help/keybindings from project page',
  { tag: ['@web', '@desktop'] },
  async ({ scene, cmdBar, context, page, fs, folderSetupFn }, testInfo) => {
    await folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fs.mkdir(bracketDir, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('cylinder-inches.kcl'),
        { encoding: 'utf-8' }
      )

      await fs.writeFile(path.join(bracketDir, 'main.kcl'), testFileData)
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    // expect to see the text bracket
    await expect(page.getByText('bracket')).toBeVisible()
    await page.getByText('bracket').click()

    await scene.settled(cmdBar)

    // click ? button
    await page.getByTestId('help-button').click()
    await expect(page.getByTestId('keybindings-button')).toBeVisible()
    // Click keyboard shortcuts button.
    await page.getByTestId('keybindings-button').click()
    // Make sure the keyboard shortcuts modal is visible.
    await expect(page.getByText('Enter Sketch Mode')).toBeVisible()
  }
)

test(
  'open a file in a project works and renders, open another file in different project with errors, it should clear the scene',
  { tag: ['@web', '@desktop'] },
  async ({
    homePage,
    toolbar,
    scene,
    cmdBar,
    context,
    page,
    editor,
    fs,
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fs.mkdir(bracketDir, { recursive: true })
      let testFileData = await nodeFs.readFile(
        executorInputPath('cylinder-inches.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(path.join(bracketDir, 'main.kcl'), testFileData)
      const errorDir = path.join(dir, 'broken-code')
      await fs.mkdir(errorDir, { recursive: true })
      testFileData = await nodeFs.readFile(
        executorInputPath('broken-code-test.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(path.join(errorDir, 'main.kcl'), testFileData)
    })

    const u = await getUtils(page)

    await test.step('Opening the bracket project should load the stream', async () => {
      await homePage.openProject('bracket')
      await scene.settled(cmdBar)
    })

    await u.doAndWaitForImageDiff(
      async () => {
        await toolbar.logoLink.click()
        await homePage.openProject('broken-code')
        await scene.settled(cmdBar, { expectError: true })

        await test.step('Verify error appears', async () => {
          await editor.scrollToText(
            "|> line(end = [0, wallMountL], tag = 'outerEdge')"
          )
          // error in gutter
          await expect(page.locator('.cm-lint-marker-error')).toBeVisible({
            timeout: 10_000,
          })
          // error text on hover
          await page.hover('.cm-lint-marker-error')
          const crypticErrorText =
            'tag requires a value with type `TagDecl`, but found a value with type `string`.'
          await expect(page.getByText(crypticErrorText).first()).toBeVisible()
        })
      },
      500,
      scene.streamWrapper
    )
  }
)

test(
  'open a file in a project works and renders, open another file in different project that is empty, it should clear the scene',
  { tag: ['@web', '@desktop'] },
  async ({
    toolbar,
    editor,
    scene,
    cmdBar,
    context,
    page,
    homePage,
    fs,
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fs.mkdir(bracketDir, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('cylinder-inches.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(path.join(bracketDir, 'main.kcl'), testFileData)
      const emptyDir = path.join(dir, 'empty')
      await fs.mkdir(emptyDir, { recursive: true })
      await fs.writeFile(path.join(emptyDir, 'main.kcl'), '')
    })

    const u = await getUtils(page)

    await test.step('Opening the bracket project should load the stream', async () => {
      await homePage.openProject('bracket')
      await scene.settled(cmdBar)
    })

    await u.doAndWaitForImageDiff(
      async () => {
        await toolbar.logoLink.click()
        await homePage.openProject('empty')
        await scene.settled(cmdBar)
      },
      500,
      scene.streamWrapper
    )

    await test.step('Ensure the code is empty', async () => {
      await editor.expectEditor.toBe('\n')
    })
  }
)

test(
  'open a file in a project works and renders, open empty file, it should clear the scene',
  { tag: ['@web', '@desktop'] },
  async ({
    scene,
    cmdBar,
    context,
    page,
    toolbar,
    editor,
    homePage,
    fs,
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fs.mkdir(bracketDir, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('cylinder-inches.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(path.join(bracketDir, 'main.kcl'), testFileData)

      await fs.writeFile(path.join(bracketDir, 'empty.kcl'), '')
    })

    const u = await getUtils(page)

    await test.step('Opening the bracket project should load the stream', async () => {
      await homePage.openProject('bracket')
      await scene.settled(cmdBar)
    })

    await u.doAndWaitForImageDiff(
      async () => {
        await toolbar.openPane(DefaultLayoutPaneID.Files)
        await toolbar.openFile('empty.kcl')
        await toolbar.closePane(DefaultLayoutPaneID.Files)
        await scene.settled(cmdBar)
      },
      500,
      scene.streamWrapper
    )

    await test.step('Ensure the code is empty', async () => {
      await editor.expectEditor.toBe('\n')
    })
  }
)

test(
  'open a file in a project works and renders, open another file in the same project with errors, it should clear the scene',
  { tag: '@desktop' },
  async ({
    scene,
    cmdBar,
    context,
    page,
    toolbar,
    homePage,
    editor,
    fs,
    folderSetupFn,
  }) => {
    await folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fs.mkdir(bracketDir, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('cylinder-inches.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(path.join(bracketDir, 'main.kcl'), testFileData)

      const brokenFileData = await nodeFs.readFile(
        executorInputPath('broken-code-test.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(
        path.join(bracketDir, 'broken-code-test.kcl'),
        brokenFileData
      )
    })

    const u = await getUtils(page)

    await test.step('Opening the bracket project should load the stream', async () => {
      await homePage.openProject('bracket')
      await scene.settled(cmdBar)
    })

    await u.doAndWaitForImageDiff(
      async () => {
        await toolbar.openPane(DefaultLayoutPaneID.Files)
        await toolbar.openFile('broken-code-test.kcl')
        await toolbar.closePane(DefaultLayoutPaneID.Files)
        await scene.settled(cmdBar, { expectError: true })

        await test.step('Verify error appears', async () => {
          await editor.scrollToText(
            "|> line(end = [0, wallMountL], tag = 'outerEdge')"
          )
          // error in gutter
          await expect(page.locator('.cm-lint-marker-error')).toBeVisible({
            timeout: 10_000,
          })
          // error text on hover
          await page.hover('.cm-lint-marker-error')
          const crypticErrorText =
            'tag requires a value with type `TagDecl`, but found a value with type `string`.'
          await expect(page.getByText(crypticErrorText).first()).toBeVisible()
        })
      },
      500,
      scene.streamWrapper
    )
  }
)

test(
  'when code with error first loads you get errors in console',
  {
    tag: ['@web', '@desktop'],
  },
  async (
    { context, page, editor, fs, folderSetupFn, homePage, scene, cmdBar },
    testInfo
  ) => {
    const u = await getUtils(page)

    await folderSetupFn(async (dir) => {
      await fs.mkdir(path.join(dir, 'broken-code'), { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('broken-code-test.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(
        path.join(dir, 'broken-code', 'main.kcl'),
        testFileData
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await homePage.openProject('broken-code')
    await scene.settled(cmdBar)

    // Gotcha: Scroll to the text content in code mirror because CodeMirror lazy loads DOM content
    await editor.scrollToText(
      "|> line(end = [0, wallMountL], tag = 'outerEdge')"
    )
    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    const crypticErrorText =
      'tag requires a value with type `TagDecl`, but found a value with type `string`.'
    await expect(page.getByText(crypticErrorText).first()).toBeVisible()
  }
)

test(
  'Rename and delete projects, also spam arrow keys when renaming',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ context, page, fs, folderSetupFn }, testInfo) => {
    await folderSetupFn(async (dir) => {
      await fs.mkdir(`${dir}/router-template-slate`, { recursive: true })
      let testFileData = await nodeFs.readFile(
        executorInputPath('router-template-slate.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(`${dir}/router-template-slate/main.kcl`, testFileData)

      await fs.mkdir(`${dir}/bracket`, { recursive: true })
      testFileData = await nodeFs.readFile(
        executorInputPath('focusrite_scarlett_mounting_bracket.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(`${dir}/bracket/main.kcl`, testFileData)

      await fs.mkdir(`${dir}/lego`, { recursive: true })
      testFileData = await nodeFs.readFile(executorInputPath('lego.kcl'), {
        encoding: 'utf-8',
      })
      await fs.writeFile(`${dir}/lego/main.kcl`, testFileData)
    })

    await page.setBodyDimensions({ width: 1200, height: 600 })

    page.on('console', console.log)

    await test.step('rename a project clicking buttons checking left and right arrow does not impact the text', async () => {
      const routerTemplate = page.getByText('router-template-slate')

      await routerTemplate.hover()
      await routerTemplate.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('router-template-slate')

      await page.waitForTimeout(100)

      await page.keyboard.press('Backspace')
      await page.keyboard.type('updated project name')

      // spam arrow keys to make sure it doesn't impact the text
      for (let i = 0; i < 10; i++) {
        await page.keyboard.press('ArrowRight')
      }
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('ArrowLeft')
      }

      await page.getByLabel('checkmark').last().click()

      await expect(page.getByText('Successfully renamed')).toBeVisible()
      await expect(page.getByText('Successfully renamed')).not.toBeVisible()
      await expect(page.getByText('updated project name')).toBeVisible()
    })

    await test.step('update a project by hitting enter', async () => {
      const project = page.getByText('updated project name')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('updated project name')

      // type "updated project name"
      await page.keyboard.press('Backspace')
      await page.keyboard.type('updated name again')

      await page.keyboard.press('Enter')

      await expect(page.getByText('Successfully renamed')).toBeVisible()
      await expect(page.getByText('Successfully renamed')).not.toBeVisible()

      await expect(page.getByText('updated name again')).toBeVisible()
    })

    await test.step('Cancel and edit by clicking the x button', async () => {
      const project = page.getByText('updated name again')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('updated name again')

      await page.keyboard.press('Backspace')
      await page.keyboard.type('dismiss this text')

      await page.getByLabel('close').last().click()

      await expect(page.getByText('updated name again')).toBeVisible()
    })

    await test.step('Cancel and edit by pressing esc', async () => {
      const project = page.getByText('updated name again')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('updated name again')

      await page.keyboard.press('Backspace')
      await page.keyboard.type('dismiss this text')

      await page.keyboard.press('Escape')

      await expect(page.getByText('updated name again')).toBeVisible()
    })

    await test.step('delete a project by clicking the trash button', async () => {
      const project = page.getByText('updated name again')

      await project.hover()
      await project.focus()

      await expect(page.getByLabel('trash').last()).toBeVisible()
      await page.getByLabel('trash').last().click()

      await expect(page.getByText('This will permanently delete')).toBeVisible()

      await page.getByTestId('delete-confirmation').click()

      await expect(page.getByText('Successfully deleted')).toBeVisible()
      await expect(page.getByText('Successfully deleted')).not.toBeVisible()

      await expect(page.getByText('updated name again')).not.toBeVisible()
    })

    await test.step('rename a project to an empty string should make the field complain', async () => {
      const routerTemplate = page.getByText('bracket')

      await routerTemplate.hover()
      await routerTemplate.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })

      expect(selectedText).toBe('bracket')

      // type "updated project name"
      await page.keyboard.press('Backspace')

      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
      await page.keyboard.press('Enter')
      await page.waitForTimeout(100)
      await page.keyboard.press('Escape')

      // expect the name not to have changed
      await expect(page.getByText('bracket')).toBeVisible()
    })

    await test.step(`rename a project to a duplicate name should error toast`, async () => {
      const routerTemplate = page.getByText('bracket')

      await routerTemplate.hover()
      await routerTemplate.focus()

      await expect(page.getByLabel('sketch').last()).toBeVisible()
      await page.getByLabel('sketch').last().click()

      const inputField = page.getByTestId('project-rename-input')
      await expect(inputField).toBeVisible()
      await expect(inputField).toBeFocused()
      await inputField.fill('lego')
      await page.keyboard.press('Enter')
      await expect(page.getByText('already exists')).toBeVisible()
    })
  }
)

test(
  'pressing "delete" on home screen should do nothing',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ context, page, homePage, fs, folderSetupFn }, testInfo) => {
    await folderSetupFn(async (dir) => {
      await fs.mkdir(`${dir}/router-template-slate`, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('router-template-slate.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(`${dir}/router-template-slate/main.kcl`, testFileData)
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await expect(page.getByText('router-template-slate')).toBeVisible()
    await expect(page.getByText('Loading your Projects...')).not.toBeVisible()
    await homePage.expectIsCurrentPage()

    await page.keyboard.press('Delete')
    await page.waitForTimeout(200)
    await page.keyboard.press('Delete')

    // expect to still be on the home page
    await expect(page.getByText('router-template-slate')).toBeVisible()
    await homePage.expectIsCurrentPage()
  }
)

test.describe(
  `Project management commands`,
  { tag: ['@web', '@desktop'] },
  () => {
    test(`Rename from project page`, async ({
      context,
      page,
      scene,
      cmdBar,
      fs,
      folderSetupFn,
    }, testInfo) => {
      const projectName = `my_project_to_rename`
      await folderSetupFn(async (dir) => {
        await fs.mkdir(`${dir}/${projectName}`, { recursive: true })
        const testFileData = await nodeFs.readFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl', { encoding: 'utf-8' })
        await fs.writeFile(`${dir}/${projectName}/main.kcl`, testFileData)
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')

      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', {
        name: 'rename project',
      })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const projectRenamedName = `my_project_after_rename_from_project`
      const commandContinueButton = page.getByRole('button', {
        name: 'Continue',
      })
      const toastMessage = page.getByText(`Successfully renamed`)

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)

        await projectHomeLink.click()
        await scene.settled(cmdBar)
      })

      await test.step(`Run rename command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()
        await projectNameOption.click()

        // Fill in the new project name
        const newNameInput = page.getByTestId('cmd-bar-arg-value')
        await expect(newNameInput).toBeVisible()
        await newNameInput.fill(projectRenamedName)

        await expect(commandContinueButton).toBeVisible()
        await commandContinueButton.click()

        await cmdBar.submit()

        await expect(toastMessage).toBeVisible()
      })

      const projectSidebarToggle = page.getByTestId('project-sidebar-toggle')
      await test.step(`Check the project was renamed (check breadcrumb)`, async () => {
        await expect(projectSidebarToggle).toBeVisible()
        await expect(projectSidebarToggle).toContainText(projectRenamedName)
      })
    })
  
    test(`Delete from project page`, async ({
      context,
      page,
      scene,
      cmdBar,
      fs,
      folderSetupFn,
    }, testInfo) => {
      const projectName = `my_project_to_delete`
      await folderSetupFn(async (dir) => {
        await fs.mkdir(`${dir}/${projectName}`, { recursive: true })
        const testFileData = await nodeFs.readFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          { encoding: 'utf-8' }
        )
        await fs.writeFile(`${dir}/${projectName}/main.kcl`, testFileData)
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', {
        name: 'delete project',
      })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const commandWarning = page.getByText('Are you sure you want to delete?')
      const toastMessage = page.getByText(`Successfully deleted`)
      const noProjectsMessage = page.getByText('No projects found')

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)

        await projectHomeLink.click()
        await scene.settled(cmdBar)
      })

      await test.step(`Run delete command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()
        await projectNameOption.click()

        await expect(commandWarning).toBeVisible()
        await cmdBar.submit()

        await expect(toastMessage).toBeVisible()
      })

      await test.step(`Check the project was deleted and we navigated home`, async () => {
        await expect(noProjectsMessage).toBeVisible()
      })
    })
    test(`Rename from home page`, async ({
      context,
      page,
      homePage,
      scene,
      cmdBar,
      fs,
      folderSetupFn,
    }, testInfo) => {
      const projectName = `my_project_to_rename`
      await folderSetupFn(async (dir) => {
        await fs.mkdir(`${dir}/${projectName}`, { recursive: true })
        const testFileData = await nodeFs.readFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl', { encoding: 'utf-8' })
        await fs.writeFile(`${dir}/${projectName}/main.kcl`, testFileData)
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', {
        name: 'rename project',
      })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const projectRenamedName = `my_project_after_rename_from_home`
      const commandContinueButton = page.getByRole('button', {
        name: 'Continue',
      })
      const toastMessage = page.getByText(`Successfully renamed`)

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)
        await homePage.projectsLoaded()
        await expect(projectHomeLink).toBeVisible()
      })

      await test.step(`Run rename command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()
        await projectNameOption.click()

        // Fill in the new project name
        const newNameInput = page.getByTestId('cmd-bar-arg-value')
        await expect(newNameInput).toBeVisible()
        await newNameInput.fill(projectRenamedName)

        await expect(commandContinueButton).toBeVisible()
        await commandContinueButton.click()

        await cmdBar.submit()

        await expect(toastMessage).toBeVisible()
      })

      await test.step(`Check the project was renamed`, async () => {
        await expect(
          page.getByRole('link', { name: projectRenamedName })
        ).toBeVisible()
        await expect(projectHomeLink).not.toHaveText(projectName)
      })
    })
    test(`Delete from home page`, async ({
      context,
      page,
      scene,
      cmdBar,
      fs,
      folderSetupFn,
    }, testInfo) => {
      const projectName = `my_project_to_delete`
      await folderSetupFn(async (dir) => {
        await fs.mkdir(`${dir}/${projectName}`, { recursive: true })
        const testFileData = await nodeFs.readFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          { encoding: 'utf-8' }
        )
        await fs.writeFile(`${dir}/${projectName}/main.kcl`, testFileData)
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', {
        name: 'delete project',
      })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const commandWarning = page.getByText('Are you sure you want to delete?')
      const toastMessage = page.getByText(`Successfully deleted`)
      const noProjectsMessage = page.getByText('No projects found')

      await test.step(`Setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        page.on('console', console.log)
        await expect(projectHomeLink).toBeVisible()
      })

      await test.step(`Run delete command via command palette`, async () => {
        await commandButton.click()
        await commandOption.click()

        await projectNameOption.click()

        await expect(commandWarning).toBeVisible()
        await cmdBar.submit()

        await expect(toastMessage).toBeVisible()
      })

      await test.step(`Check the project was deleted`, async () => {
        await expect(projectHomeLink).not.toBeVisible()
        await expect(noProjectsMessage).toBeVisible()
      })
    })
    test('Create a new project with a colliding name', async ({
      context,
      homePage,
      toolbar,
      fs,
      folderSetupFn,
    }) => {
      const projectName = 'test-project'
      await test.step('Setup', async () => {
        await folderSetupFn(async (dir) => {
          const projectDir = path.join(dir, projectName)
          await fs.mkdir(projectDir, { recursive: true })
          const testFileData = await nodeFs.readFile(
            executorInputPath('router-template-slate.kcl'),
            { encoding: 'utf-8' }
          )
          await fs.writeFile(path.join(projectDir, 'main.kcl'), testFileData)
        })
        await homePage.expectState({
          projectCards: [
            {
              title: projectName,
              fileCount: 1,
            },
          ],
          sortBy: 'last-modified-desc',
        })
      })

      await test.step('Create a new project with the same name', async () => {
        await homePage.createAndGoToProject(projectName)
        await toolbar.logoLink.click()
      })

      await test.step('Check the project was created with a non-colliding name', async () => {
        await homePage.expectState({
          projectCards: [
            {
              title: `${projectName}-1`,
              fileCount: 1,
            },
            {
              title: projectName,
              fileCount: 1,
            },
          ],
          sortBy: 'last-modified-desc',
        })
      })

      await test.step('Create another project with the same name', async () => {
        await homePage.createAndGoToProject(projectName)
        await toolbar.logoLink.click()
      })

      await test.step('Check the second project was created with a non-colliding name', async () => {
        await homePage.expectState({
          projectCards: [
            {
              title: `${projectName}-2`,
              fileCount: 1,
            },
            {
              title: `${projectName}-1`,
              fileCount: 1,
            },
            {
              title: projectName,
              fileCount: 1,
            },
          ],
          sortBy: 'last-modified-desc',
        })
      })
    })
  }
)

test(
  `Create a few projects using the default project name`,
  { tag: ['@web', '@desktop'] },
  async ({ homePage, toolbar }) => {
    for (let i = 0; i < 12; i++) {
      await test.step(`Create project ${i}`, async () => {
        await homePage.expectState({
          projectCards: Array.from({ length: i }, (_, i) => ({
            title: i === 0 ? 'untitled' : `untitled-${i}`,
            fileCount: 1,
          })).toReversed(),
          sortBy: 'last-modified-desc',
        })
        await homePage.createAndGoToProject()
        await toolbar.logoLink.click()
      })
    }
  }
)

test(
  'project title case sensitive duplication',
  { tag: ['@web', '@desktop'] },
  async ({ homePage, page, scene, cmdBar, toolbar, folderSetupFn }) => {
    const u = await getUtils(page)

    await test.step('Create project "test" and add KCL', async () => {
      await homePage.createAndGoToProject('test')
      await scene.settled(cmdBar)

      const kcl = `sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> circle(center = [0, 0], radius = 5)
`

      // await page.waitForTimeout(3000)
      // await u.pasteCodeInEditor(kcl)
      await scene.settled(cmdBar)
    })

    await test.step('Return to dashboard', async () => {
      await toolbar.logoLink.click()
    })

    await test.step('Create project "Test" and open it', async () => {
      await homePage.createAndGoToProject('Test')
      await scene.settled(cmdBar)
    })
    await test.step('Verify duplicate resolves to "Test-1" on dashboard', async () => {
      await toolbar.logoLink.click()
      await homePage.expectState({
        projectCards: [
          { title: 'Test-1', fileCount: 1 },
          { title: 'test', fileCount: 1 },
        ],
        sortBy: 'last-modified-desc',
      })
    })
  }
)

test(
  'File in the file pane should open with a single click',
  { tag: ['@web', '@desktop'] },
  async (
    { context, homePage, page, scene, toolbar, fs, folderSetupFn },
    testInfo
  ) => {
    const projectName = 'router-template-slate'
    await folderSetupFn(async (dir) => {
      await fs.mkdir(`${dir}/${projectName}`, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('router-template-slate.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(`${dir}/${projectName}/main.kcl`, testFileData)
      const testFileData2 = await nodeFs.readFile(
        executorInputPath('focusrite_scarlett_mounting_bracket.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(
        `${dir}/${projectName}/otherThingToClickOn.kcl`,
        testFileData2
      )
    })

    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText(projectName).click()
    await u.waitForPageLoad()

    await expect(u.codeLocator).toContainText('routerDiameter')
    await expect(u.codeLocator).toContainText('templateGap')
    await expect(u.codeLocator).toContainText('minClampingDistance')

    await page.getByRole('switch', { name: 'Project Files' }).click()
    await toolbar.openFile('otherThingToClickOn.kcl')

    await expect(u.codeLocator).toContainText(
      'A mounting bracket for the Focusrite Scarlett Solo audio interface'
    )
  }
)

test(
  'Nested directories in project without main.kcl do not create main.kcl',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ scene, cmdBar, context, page, fs, folderSetupFn }, testInfo) => {
    let testDir: string | undefined
    await folderSetupFn(async (dir) => {
      await fs.mkdir(path.join(dir, 'router-template-slate', 'nested'), {
        recursive: true,
      })
      const testFileData2 = await nodeFs.readFile(
        executorInputPath('focusrite_scarlett_mounting_bracket.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(
        path.join(dir, 'router-template-slate', 'nested', 'bracket.kcl'),
        testFileData2
      )

      const testFileData = await nodeFs.readFile(
        executorInputPath('router-template-slate.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(
        path.join(dir, 'router-template-slate', 'nested', 'slate.kcl'),
        testFileData
      )

      testDir = dir
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('Open the project', async () => {
      await page.getByText('router-template-slate').click()
      await scene.settled(cmdBar)
    })

    await u.openFilePanel()

    // Find the current file.
    const filesPane = page.locator('#files-pane')
    await expect(filesPane.getByText('bracket.kcl')).toBeVisible()
    // But there's no main.kcl in the file tree browser.
    await expect(filesPane.getByText('main.kcl')).not.toBeVisible()
    // No main.kcl file is created on the filesystem.
    expect(testDir).toBeDefined()
    if (testDir !== undefined) {
      await expect(
        await fs.access(path.join(testDir, 'router-template-slate', 'main.kcl'))
      ).toBe(undefined)
      await expect(
        await fs.access(
          path.join(testDir, 'router-template-slate', 'nested', 'main.kcl')
        )
      ).toBe(undefined)
    }
  }
)

test(
  'Deleting projects, can delete individual project, can still create projects after deleting all',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ context, page, fs, folderSetupFn }, testInfo) => {
    const projectData = [
      ['router-template-slate', 'cylinder.kcl'],
      ['bracket', 'focusrite_scarlett_mounting_bracket.kcl'],
      ['lego', 'lego.kcl'],
    ]

    await folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fs.mkdir(path.join(dir, name), { recursive: true })
        const testFileData = await nodeFs.readFile(executorInputPath(file), {
          encoding: 'utf-8',
        })
        await fs.writeFile(path.join(dir, name, `main.kcl`), testFileData)
        // Wait 1s between each project to ensure the order is correct
        await new Promise((r) => setTimeout(r, 1_000))
      }
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })
    page.on('console', console.log)

    await test.step('delete the middle project, i.e. the bracket project', async () => {
      const project = page.getByTestId('project-link').getByText('bracket')

      await project.hover()
      await project.focus()

      await page
        .locator('[data-edit-buttons-for="bracket"]')
        .getByLabel('trash')
        .click()

      await expect(page.getByText('This will permanently delete')).toBeVisible()

      await page.getByTestId('delete-confirmation').click()

      await expect(page.getByText('Successfully deleted')).toBeVisible()
      await expect(page.getByText('Successfully deleted')).not.toBeVisible()

      await expect(page.getByText('bracket')).not.toBeVisible()
    })

    await test.step('Now that the middle project is deleted, check the other projects are still there', async () => {
      await expect(page.getByText('router-template-slate')).toBeVisible()
      await expect(page.getByText('lego')).toBeVisible()
    })

    await test.step('delete other two projects', async () => {
      await page
        .locator('[data-edit-buttons-for="router-template-slate"]')
        .getByLabel('trash')
        .click()
      await page.getByTestId('delete-confirmation').click()

      await page
        .locator('[data-edit-buttons-for="lego"]')
        .getByLabel('trash')
        .click()
      await page.getByTestId('delete-confirmation').click()
    })

    await test.step('Check that the home page is empty', async () => {
      await expect(page.getByText('No projects found')).toBeVisible()
    })

    await test.step('Check we can still create a project', async () => {
      await createProject({ name: 'new-project', page, returnHome: false })
      await expect(
        page.getByTestId('project-link').filter({ hasText: 'new-project' })
      ).toBeVisible()
    })
  }
)

test(
  'Can load a file with CRLF line endings',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ context, page, scene, cmdBar, fs, folderSetupFn }, testInfo) => {
    await folderSetupFn(async (dir) => {
      const routerTemplateDir = path.join(dir, 'router-template-slate')
      await fs.mkdir(routerTemplateDir, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath('router-template-slate.kcl'),
        { encoding: 'utf-8' }
      )
      // Replace both \r optionally so we don't end up with \r\r\n
      const fileWithCRLF = testFileData.replace(/\r?\n/g, '\r\n')
      await fs.writeFile(
        path.join(routerTemplateDir, 'main.kcl'),
        fileWithCRLF,
        'utf-8'
      )
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    await page.getByText('router-template-slate').click()
    await scene.settled(cmdBar)

    await expect(u.codeLocator).toContainText('routerDiameter')
    await expect(u.codeLocator).toContainText('templateGap')
    await expect(u.codeLocator).toContainText('minClampingDistance')
  }
)

test(
  'Can sort projects on home page',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ context, page, fs, folderSetupFn }, testInfo) => {
    const projectData = [
      ['router-template-slate', 'cylinder.kcl'],
      ['bracket', 'focusrite_scarlett_mounting_bracket.kcl'],
      ['lego', 'lego.kcl'],
    ]

    await folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fs.mkdir(path.join(dir, name), { recursive: true })
        const testFileData = await nodeFs.readFile(executorInputPath(file), {
          encoding: 'utf-8',
        })
        await fs.writeFile(path.join(dir, name, `main.kcl`), testFileData)

        // Wait 1s between each project to ensure the order is correct
        await new Promise((r) => setTimeout(r, 1_000))
      }
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    const getAllProjects = () => page.getByTestId('project-link').all()

    page.on('console', console.log)

    await test.step('should be shorted by modified initially', async () => {
      const lastModifiedButton = page.getByRole('button', {
        name: 'Last Modified',
      })
      await expect(lastModifiedButton).toBeVisible()
      await expect(lastModifiedButton.getByLabel('arrow down')).toBeVisible()
    })

    const projectNamesOrderedByModified = [
      'lego',
      'bracket',
      'router-template-slate',
    ]
    await test.step('Check the order of the projects is correct', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          projectNamesOrderedByModified[index]
        )
      }
    })

    await test.step('Reverse modified order', async () => {
      const lastModifiedButton = page.getByRole('button', {
        name: 'Last Modified',
      })
      await lastModifiedButton.click()
      await expect(lastModifiedButton).toBeVisible()
      await expect(lastModifiedButton.getByLabel('arrow up')).toBeVisible()
    })

    await test.step('Check the order of the projects is has reversed', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          [...projectNamesOrderedByModified].reverse()[index]
        )
      }
    })

    await test.step('Change order to by name', async () => {
      const nameButton = page.getByRole('button', {
        name: 'Name',
      })
      await nameButton.click()
      await expect(nameButton).toBeVisible()
      await expect(nameButton.getByLabel('arrow down')).toBeVisible()
    })

    const projectNamesOrderedByName = [
      'bracket',
      'lego',
      'router-template-slate',
    ]
    await test.step('Check the order of the projects is by name', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          projectNamesOrderedByName[index]
        )
      }
    })

    await test.step('Reverse name order', async () => {
      const nameButton = page.getByRole('button', {
        name: 'Name',
      })
      await nameButton.click()
      await expect(nameButton).toBeVisible()
      await expect(nameButton.getByLabel('arrow up')).toBeVisible()
    })

    await test.step('Check the order of the projects is by name reversed', async () => {
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(
          [...projectNamesOrderedByName].reverse()[index]
        )
      }
    })
  }
)

// desktop-only reason: changing roots in OPFS is not a thing.
test(
  'You can change the root projects directory and nothing is lost',
  {
    tag: '@desktop',
  },
  async ({ context, page, tronApp, homePage }, testInfo) => {
    if (!tronApp) throw new Error('tronApp is missing.')

    await context.folderSetupFn(async (dir) => {
      await Promise.all([
        nodeFs.mkdir(`${dir}/router-template-slate`, { recursive: true }),
        nodeFs.mkdir(`${dir}/bracket`, { recursive: true }),
      ])
      await Promise.all([
        nodeFs.copyFile(
          executorInputPath('router-template-slate.kcl'),
          `${dir}/router-template-slate/main.kcl`
        ),
        nodeFs.copyFile(
          executorInputPath('focusrite_scarlett_mounting_bracket.kcl'),
          `${dir}/bracket/main.kcl`
        ),
      ])
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    // we'll grab this from the settings on screen before we switch
    let originalProjectDirName: string
    const newProjectDirName = testInfo.outputPath(
      'electron-test-projects-dir-2'
    )
    if (fs.existsSync(newProjectDirName)) {
      await nodeFs.rm(newProjectDirName, { recursive: true })
    }

    await homePage.projectsLoaded()

    await test.step('We can change the root project directory', async () => {
      // expect to see the project directory settings link
      await expect(
        page.getByTestId('project-directory-settings-link')
      ).toBeVisible()

      await page.getByTestId('project-directory-settings-link').click()

      await expect(page.getByTestId('project-directory-button')).toBeVisible()
      originalProjectDirName = await page
        .locator('section#projectDirectory input')
        .inputValue()

      const handleFile = tronApp.electron.evaluate(
        async ({ dialog }, filePaths) => {
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths })
        },
        [newProjectDirName]
      )
      await page.getByTestId('project-directory-button').click()
      await handleFile

      await expect
        .poll(() => page.locator('section#projectDirectory input').inputValue())
        .toContain(newProjectDirName)

      await page.getByTestId('settings-close-button').click()

      await homePage.projectsLoaded()

      await expect(page.getByText('No projects found')).toBeVisible()
      await createProject({ name: 'project-000', page, returnHome: true })
      await expect(
        page.getByTestId('project-link').filter({ hasText: 'project-000' })
      ).toBeVisible()
    })

    await test.step('We can change back to the original root project directory', async () => {
      await expect(
        page.getByTestId('project-directory-settings-link')
      ).toBeVisible()

      await page.getByTestId('project-directory-settings-link').click()

      const handleFile = tronApp.electron.evaluate(
        async ({ dialog }, filePaths) => {
          dialog.showOpenDialog = () =>
            Promise.resolve({ canceled: false, filePaths })
        },
        [originalProjectDirName]
      )
      await expect(page.getByTestId('project-directory-button')).toBeVisible()

      await page.getByTestId('project-directory-button').click()
      await handleFile

      await homePage.projectsLoaded()
      await expect(page.locator('section#projectDirectory input')).toHaveValue(
        originalProjectDirName
      )

      await page.getByTestId('settings-close-button').click()

      await expect(page.getByText('bracket')).toBeVisible()
      await expect(page.getByText('router-template-slate')).toBeVisible()
    })
  }
)

test(
  'Search projects on desktop home',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ context, page, fs, folderSetupFn }, testInfo) => {
    const projectData = [
      ['basic bracket', 'focusrite_scarlett_mounting_bracket.kcl'],
      ['basic-cube', 'basic_fillet_cube_end.kcl'],
      ['basic-cylinder', 'cylinder.kcl'],
      ['router-template-slate', 'router-template-slate.kcl'],
      ['Ancient Temple Block', 'lego.kcl'],
    ]
    await folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fs.mkdir(path.join(dir, name), { recursive: true })
        const testFileData = await nodeFs.readFile(executorInputPath(file), {
          encoding: 'utf-8',
        })
        await fs.writeFile(path.join(dir, name, `main.kcl`), testFileData)
      }
    })
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    // Our locator constants
    const searchInput = page.getByPlaceholder('Search projects')
    const projectLinks = page.getByTestId('project-link')

    await test.step('Search for "basi"', async () => {
      await searchInput.fill('basi')
      await expect(projectLinks).toHaveCount(3)

      // Check each of the "basi" projects are visible
      for (const [name] of projectData.slice(0, 3)) {
        await expect(page.getByText(name)).toBeVisible()
      }
    })

    await test.step('Clear search to see all projects', async () => {
      await searchInput.fill('')
      await expect(projectLinks).toHaveCount(projectData.length)
    })

    await test.step('Search for "templ"', async () => {
      await searchInput.fill('templ')
      await expect(projectLinks).toHaveCount(2)

      // Check the "*templ*" project is visible
      for (const [name] of projectData.slice(-2)) {
        await expect(page.getByText(name)).toBeVisible()
      }
    })
  }
)

test(
  'file pane is scrollable when there are many files',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ scene, cmdBar, context, page, fs, folderSetupFn }, testInfo) => {
    await folderSetupFn(async (dir) => {
      const testDir = path.join(dir, 'testProject')
      await fs.mkdir(testDir, { recursive: true })
      const fileNames = [
        'angled_line.kcl',
        'basic_fillet_cube_close_opposite.kcl',
        'basic_fillet_cube_end.kcl',
        'basic_fillet_cube_next_adjacent.kcl',
        'basic_fillet_cube_previous_adjacent.kcl',
        'basic_fillet_cube_start.kcl',
        'broken-code-test.kcl',
        'circular_pattern3d_a_pattern.kcl',
        'close_arc.kcl',
        'computed_var.kcl',
        'cube-embedded.gltf',
        'cube.bin',
        'cube.glb',
        'cube.gltf',
        'cube.kcl',
        'cube.mtl',
        'cube.obj',
        'cylinder.kcl',
        'dimensions_match.kcl',
        'extrude-custom-plane.kcl',
        'extrude-inside-fn-with-tags.kcl',
        'fillet-and-shell.kcl',
        'focusrite_scarlett_mounting_bracket.kcl',
        'function_sketch.kcl',
        'function_sketch_with_position.kcl',
        'global-tags.kcl',
        'helix_defaults.kcl',
        'helix_defaults_negative_extrude.kcl',
        'helix_with_length.kcl',
        'kittycad_svg.kcl',
        'lego.kcl',
        'lsystem.kcl',
        'math.kcl',
        'member_expression_sketch.kcl',
        'mike_stress_test.kcl',
        'negative_args.kcl',
        'order-sketch-extrude-in-order.kcl',
        'order-sketch-extrude-out-of-order.kcl',
        'parametric.kcl',
        'parametric_with_tan_arc.kcl',
        'pattern_vase.kcl',
        'pentagon_fillet_sugar.kcl',
        'pipe_as_arg.kcl',
        'pipes_on_pipes.kcl',
        'riddle.kcl',
        'riddle_small.kcl',
        'router-template-slate.kcl',
        'scoped-tags.kcl',
        'server-rack-heavy.kcl',
        'server-rack-lite.kcl',
        'sketch_on_face.kcl',
        'sketch_on_face_circle_tagged.kcl',
        'sketch_on_face_end.kcl',
        'sketch_on_face_end_negative_extrude.kcl',
        'sketch_on_face_start.kcl',
        'tan_arc_x_line.kcl',
        'tangential_arc.kcl',
      ]
      for (const fileName of fileNames) {
        const testFileData = await nodeFs.readFile(
          executorInputPath(fileName),
          { encoding: 'utf-8' }
        )
        await fs.writeFile(path.join(testDir, fileName), testFileData)
      }
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('setup, open file pane', async () => {
      await page.getByText('testProject').click()

      await scene.settled(cmdBar)

      await page.getByTestId('files-pane-button').click()
    })

    await test.step('check the last file is out of view initially, and can be scrolled to', async () => {
      const u = await getUtils(page)
      const element = u.locatorFile('tangential_arc.kcl')
      const container = page.getByTestId('file-pane-scroll-container')

      await expect(await isOutOfViewInScrollContainer(element, container)).toBe(
        true
      )
      await element.scrollIntoViewIfNeeded()
      await expect(await isOutOfViewInScrollContainer(element, container)).toBe(
        false
      )
    })
  }
)

test(
  'select all in code editor does not actually select all, just what is visible (regression)',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ context, page, fs, folderSetupFn, cmdBar, scene }, testInfo) => {
    await folderSetupFn(async (dir) => {
      // rust/kcl-lib/e2e/executor/inputs/mike_stress_test.kcl
      const name = 'mike_stress_test'
      const testDir = path.join(dir, name)
      await fs.mkdir(testDir, { recursive: true })
      const testFileData = await nodeFs.readFile(
        executorInputPath(`${name}.kcl`),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(path.join(testDir, 'main.kcl'), testFileData)
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await page.getByText('mike_stress_test').click()
    await closeOnboardingModalIfPresent(page)

    await test.step('select all in code editor, check its length', async () => {
      await u.codeLocator.click()
      // expect u.codeLocator to have some text
      await expect(u.codeLocator).toContainText('line(')
      await page.keyboard.down('ControlOrMeta')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('ControlOrMeta')

      // check the length of the selected text
      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })
      // even though if the user copied the text into their clipboard they would get the full text
      // it seems that the selection is limited to what is visible
      // we just want to check we did select something, and later we've verify it's empty
      expect(selectedText.length).toBeGreaterThan(10)
    })

    await test.step('delete all the text, select again and verify there are no characters left', async () => {
      await page.keyboard.press('Backspace')

      await page.keyboard.down('ControlOrMeta')
      await page.keyboard.press('KeyA')
      await page.keyboard.up('ControlOrMeta')

      // check the length of the selected text
      const selectedText = await page.evaluate(() => {
        const selection = window.getSelection()
        return selection ? selection.toString() : ''
      })
      expect(selectedText.length).toBe(0)
      await expect(u.codeLocator).toHaveText('')
    })
  }
)

test(
  'Settings persist across restarts',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ page, toolbar }, testInfo) => {
    await test.step('We can change a user setting like theme', async () => {
      await page.setBodyDimensions({ width: 1200, height: 500 })

      page.on('console', console.log)

      await toolbar.userSidebarButton.click()

      await page.getByTestId('user-settings').click()

      await page.getByTestId('app-theme').selectOption('light')
      await expect(page.getByTestId('app-theme')).toHaveValue('light')

      // Give time to system for writing to a persistent store
      await page.waitForTimeout(1000)
    })

    await test.step('Starting the app again and we can see the same theme', async () => {
      await page.reload()
      await page.setBodyDimensions({ width: 1200, height: 500 })

      page.on('console', console.log)
      await expect(page.getByTestId('app-theme')).toHaveValue('light')
    })
  }
)

test(
  'Original project name persist after onboarding',
  {
    tag: ['@web', '@desktop'],
  },
  async ({ page, toolbar, scene, cmdBar }, testInfo) => {
    const nextButton = page.getByTestId('onboarding-next')
    await page.setBodyDimensions({ width: 1200, height: 500 })

    const getAllProjects = () => page.getByTestId('project-link').all()
    page.on('console', console.log)

    await test.step('Should create and name a project called wrist brace', async () => {
      await createProject({ name: 'wrist brace', page, returnHome: true })
    })

    await test.step('Should go through onboarding', async () => {
      await toolbar.userSidebarButton.click()
      await page.getByTestId('user-settings').click()
      await page.getByRole('button', { name: 'Replay Onboarding' }).click()

      while ((await nextButton.innerText()) !== 'Finish') {
        await nextButton.click()
      }
      await nextButton.click()

      await page.getByTestId('project-sidebar-toggle').click()
    })

    await test.step('Should go home after onboarding is completed', async () => {
      await page.getByTestId('app-logo').click()
    })

    await test.step('Should show the original project called wrist brace', async () => {
      const projectNames = ['tutorial-project', 'wrist brace']
      for (const [index, projectLink] of (await getAllProjects()).entries()) {
        await expect(projectLink).toContainText(projectNames[index])
      }
    })
  }
)

// Desktop-only because browser uses UTF-16 for text encoding so shit's a bit
// fucked when trying to mix them. I (lee) mainly care it works on desktop.
test(
  'project name with foreign characters should open',
  { tag: ['@desktop'] },
  async ({ context, page, cmdBar, scene, homePage, fs, folderSetupFn }) => {
    const projectName = 'にゅにゅ'
    await folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, projectName)
      await fs.mkdir(bracketDir, { recursive: true })
      console.log('READDIR', await fs.readdir(dir))
      const testFileData = await nodeFs.readFile(
        executorInputPath('cylinder-inches.kcl'),
        { encoding: 'utf-8' }
      )
      const finalPath = path.join(bracketDir, 'main.kcl')
      await fs.writeFile(finalPath, testFileData)
    })

    await homePage.openProject(projectName)
    await scene.settled(cmdBar)
  }
)

test(
  'import from nested directory',
  { tag: ['@web', '@desktop', '@windows', '@macos'] },
  async ({
    homePage,
    scene,
    cmdBar,
    context,
    page,
    editor,
    fs,
    folderSetupFn,
  }) => {
    const lineOfKcl = runningOnWindows()
      ? `import 'nested\\main.kcl' as thing`
      : `import 'nested/main.kcl' as thing`
    await folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fs.mkdir(bracketDir, { recursive: true })
      const nestedDir = path.join(bracketDir, 'nested')
      await fs.mkdir(nestedDir, { recursive: true })

      const testFileData = await nodeFs.readFile(
        executorInputPath('cylinder-inches.kcl'),
        { encoding: 'utf-8' }
      )
      await fs.writeFile(path.join(nestedDir, 'main.kcl'), testFileData)

      await fs.writeFile(
        path.join(bracketDir, 'main.kcl'),
        new TextEncoder().encode(`${lineOfKcl}\n\nthing`)
      )
    })

    await test.step('Opening the bracket project should load the stream', async () => {
      // expect to see the text bracket
      await homePage.openProject('bracket')
      await scene.settled(cmdBar)

      await editor.expectState({
        activeLines: [lineOfKcl],
        diagnostics: [],
        highlightedCode: '',
      })
    })
  }
)

test(
  'segment position changes persist after dragging and reopening project',
  { tag: ['@web', '@desktop'] },
  async ({
    scene,
    cmdBar,
    context,
    page,
    editor,
    toolbar,
    fs,
    folderSetupFn,
  }) => {
    const projectName = 'segment-drag-test'

    await folderSetupFn(async (dir) => {
      const projectDir = path.join(dir, projectName)
      await fs.mkdir(projectDir, { recursive: true })
      await fs.writeFile(
        path.join(projectDir, 'main.kcl'),
        `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [0, 0])
  |> line(end = [0, 6])
  |> line(end = [10, 0])
  |> line(end = [-8, -5])
`
      )
    })
    const u = await getUtils(page)

    await test.step('Opening the project and entering sketch mode', async () => {
      await expect(page.getByText(projectName)).toBeVisible()
      await page.getByText(projectName).click()
      await scene.settled(cmdBar)

      // go to sketch mode
      await (await toolbar.getFeatureTreeOperation('Sketch', 0)).dblclick()
    })

    const lineToChange = 'line(end = [-8, -5])'
    const lineToStay = 'line(end = [10, 0])'

    await test.step('Dragging the line endpoint to modify it', async () => {
      // Get the last line's endpoint position
      const lineEnd = await u.getBoundingBox('[data-overlay-index="3"]')

      await page.mouse.move(lineEnd.x, lineEnd.y - 5)
      await page.mouse.down()
      await page.mouse.move(lineEnd.x + 80, lineEnd.y)
      await page.mouse.up()

      await editor.expectEditor.not.toContain(lineToChange)
      await editor.expectEditor.toContain(lineToStay)

      // Exit sketch mode
      await page.keyboard.press('Escape')
      await page.waitForTimeout(100)
    })

    await test.step('Going back to dashboard', async () => {
      await page.getByTestId('app-logo').click()
      await page.waitForTimeout(1000)
    })

    await test.step('Reopening the project and verifying changes are saved', async () => {
      await page.getByText(projectName).click()

      // Check if new line coordinates were saved
      await editor.expectEditor.not.toContain(lineToChange)
      await editor.expectEditor.toContain(lineToStay)
    })
  }
)

test.describe('Project id', { tag: ['@web', '@desktop'] }, () => {
  // Should work on both web and desktop.
  test('is created on new project', async ({
    page,
    toolbar,
    context,
    homePage,
  }, testInfo) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })
    await createProject({ name: 'new-project', page, returnHome: false })
    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const inputProjectId = page.getByTestId('project-id')

    await test.step('Open the project settings modal', async () => {
      await toolbar.projectSidebarToggle.click()
      await page.getByTestId('project-settings').click()
      // Give time to system for writing to a persistent store
      await page.waitForTimeout(1000)
    })

    await test.step('Check project id is not the NIL UUID and not empty', async () => {
      await expect(inputProjectId).not.toHaveValue(uuidNIL)
      await expect(inputProjectId).toHaveValue(REGEXP_UUIDV4)
    })
  })
  test('is created on existing project without one', async ({
    page,
    toolbar,
    context,
    homePage,
    fs,
    folderSetupFn,
  }, testInfo) => {
    const u = await getUtils(page)

    await page.setBodyDimensions({ width: 1200, height: 500 })

    await createProject({ name: 'new-project', page, returnHome: false })
    await homePage.goToModelingScene()

    await u.waitForPageLoad()

    const inputProjectId = page.getByTestId('project-id')

    await test.step('Open the project settings modal', async () => {
      await toolbar.projectSidebarToggle.click()
      await page.getByTestId('project-settings').click()
      // Give time to system for writing to a persistent store
      await page.waitForTimeout(1000)
    })

    await test.step('Check project id is not the NIL UUID and not empty', async () => {
      await expect(inputProjectId).not.toHaveValue(uuidNIL)
      await expect(inputProjectId).toHaveValue(REGEXP_UUIDV4)
    })
  })
})
