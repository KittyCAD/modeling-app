import fs from 'fs'
import path from 'path'
import { DEFAULT_PROJECT_KCL_FILE } from '@src/lib/constants'
import fsp from 'fs/promises'

import {
  createProject,
  executorInputPath,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test(
  'projects reload if a new one is created, deleted, or renamed externally',
  { tag: ['@desktop', '@macos', '@windows'] },
  async ({ context, page }, testInfo) => {
    let externalCreatedProjectName = 'external-created-project'

    let targetDir = ''

    await context.folderSetupFn(async (dir) => {
      targetDir = dir
      setTimeout(() => {
        const myDir = path.join(dir, externalCreatedProjectName)
        ;(async () => {
          await fsp.mkdir(myDir)
          await fsp.writeFile(
            path.join(myDir, DEFAULT_PROJECT_KCL_FILE),
            'meaningless nonsense here'
          )
        })().catch(console.error)
      }, 5000)
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })

    const projectLinks = page.getByTestId('project-link')

    await projectLinks.first().waitFor()
    await expect(projectLinks).toContainText(externalCreatedProjectName)

    await fsp.rename(
      path.join(targetDir, externalCreatedProjectName),
      path.join(targetDir, externalCreatedProjectName + '1')
    )

    externalCreatedProjectName += '1'
    await expect(projectLinks).toContainText(externalCreatedProjectName)

    await fsp.rm(path.join(targetDir, externalCreatedProjectName), {
      recursive: true,
      force: true,
    })

    await expect(projectLinks).toHaveCount(0)
  }
)

test(
  'click help/keybindings from home page',
  { tag: '@desktop' },
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
  { tag: '@desktop' },
  async ({ scene, cmdBar, context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cylinder-inches.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
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
  { tag: '@desktop' },
  async ({ homePage, toolbar, scene, cmdBar, context, page, editor }) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cylinder-inches.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
      const errorDir = path.join(dir, 'broken-code')
      await fsp.mkdir(errorDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('broken-code-test.kcl'),
        path.join(errorDir, 'main.kcl')
      )
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
  { tag: '@desktop' },
  async ({ toolbar, editor, scene, cmdBar, context, page, homePage }) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cylinder-inches.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
      const emptyDir = path.join(dir, 'empty')
      await fsp.mkdir(emptyDir, { recursive: true })
      await fsp.writeFile(path.join(emptyDir, 'main.kcl'), '')
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
  { tag: '@desktop' },
  async ({ scene, cmdBar, context, page, toolbar, editor, homePage }) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cylinder-inches.kcl'),
        path.join(bracketDir, 'main.kcl')
      )

      await fsp.writeFile(path.join(bracketDir, 'empty.kcl'), '')
    })

    const u = await getUtils(page)

    await test.step('Opening the bracket project should load the stream', async () => {
      await homePage.openProject('bracket')
      await scene.settled(cmdBar)
    })

    await u.doAndWaitForImageDiff(
      async () => {
        await toolbar.openPane('files')
        await toolbar.openFile('empty.kcl')
        await toolbar.closePane('files')
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
  async ({ scene, cmdBar, context, page, toolbar, homePage, editor }) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'bracket')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('cylinder-inches.kcl'),
        path.join(bracketDir, 'main.kcl')
      )
      await fsp.copyFile(
        executorInputPath('broken-code-test.kcl'),
        path.join(bracketDir, 'broken-code-test.kcl')
      )
    })

    const u = await getUtils(page)

    await test.step('Opening the bracket project should load the stream', async () => {
      await homePage.openProject('bracket')
      await scene.settled(cmdBar)
    })

    await u.doAndWaitForImageDiff(
      async () => {
        await toolbar.openPane('files')
        await toolbar.openFile('broken-code-test.kcl')
        await toolbar.closePane('files')
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
    tag: '@desktop',
  },
  async ({ context, page, editor }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(path.join(dir, 'broken-code'), { recursive: true })
      await fsp.copyFile(
        executorInputPath('broken-code-test.kcl'),
        path.join(dir, 'broken-code', 'main.kcl')
      )
    })

    await page.setBodyDimensions({ width: 1200, height: 500 })
    await expect(page.getByText('broken-code')).toBeVisible()
    await page.getByText('broken-code').click()

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
    tag: '@desktop',
  },
  async ({ context, page }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(`${dir}/router-template-slate`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
        `${dir}/router-template-slate/main.kcl`
      )
      const _1975 = new Date('1975-01-01T00:01:11')
      fs.utimesSync(`${dir}/router-template-slate/main.kcl`, _1975, _1975)

      await fsp.mkdir(`${dir}/bracket`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/focusrite_scarlett_mounting_bracket.kcl',
        `${dir}/bracket/main.kcl`
      )
      const _1985 = new Date('1985-01-01T00:02:22')
      fs.utimesSync(`${dir}/bracket/main.kcl`, _1985, _1985)

      await new Promise((r) => setTimeout(r, 1_000))
      await fsp.mkdir(`${dir}/lego`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/lego.kcl',
        `${dir}/lego/main.kcl`
      )
      const _1995 = new Date('1995-01-01T00:03:33')
      fs.utimesSync(`${dir}/lego/main.kcl`, _1995, _1995)
    })

    await page.setBodyDimensions({ width: 1200, height: 600 })

    page.on('console', console.log)

    await page.waitForTimeout(1_000)

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
    tag: '@desktop',
  },
  async ({ context, page, homePage }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(`${dir}/router-template-slate`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
        `${dir}/router-template-slate/main.kcl`
      )
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

test.describe(`Project management commands`, () => {
  test(
    `Rename from project page`,
    { tag: '@desktop' },
    async ({ context, page, scene, cmdBar }, testInfo) => {
      const projectName = `my_project_to_rename`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', {
        name: 'rename project',
      })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const projectRenamedName = `untitled`
      // const projectMenuButton = page.getByTestId('project-sidebar-toggle')
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

        await expect(commandContinueButton).toBeVisible()
        await commandContinueButton.click()

        await cmdBar.submit()

        await expect(toastMessage).toBeVisible()
      })

      // TODO: in future I'd like the behavior to be to
      // navigate to the new project's page directly,
      // see ProjectContextProvider.tsx:158
      await test.step(`Check the project was renamed and we navigated home`, async () => {
        await expect(projectHomeLink.first()).toBeVisible()
        await expect(projectHomeLink.first()).toContainText(projectRenamedName)
      })
    }
  )

  test(
    `Delete from project page`,
    { tag: '@desktop' },
    async ({ context, page, scene, cmdBar }, testInfo) => {
      const projectName = `my_project_to_delete`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
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

        await page.waitForTimeout(3000)

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
    }
  )
  test(
    `Rename from home page`,
    { tag: '@desktop' },
    async ({ context, page, homePage, scene, cmdBar }, testInfo) => {
      const projectName = `my_project_to_rename`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
      })

      // Constants and locators
      const projectHomeLink = page.getByTestId('project-link')
      const commandButton = page.getByRole('button', { name: 'Commands' })
      const commandOption = page.getByRole('option', {
        name: 'rename project',
      })
      const projectNameOption = page.getByRole('option', { name: projectName })
      const projectRenamedName = `untitled`
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
    }
  )
  test(
    `Delete from home page`,
    { tag: '@desktop' },
    async ({ context, page, scene, cmdBar }, testInfo) => {
      const projectName = `my_project_to_delete`
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
        await fsp.copyFile(
          'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
          `${dir}/${projectName}/main.kcl`
        )
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
    }
  )
  test('Create a new project with a colliding name', async ({
    context,
    homePage,
    toolbar,
  }) => {
    const projectName = 'test-project'
    await test.step('Setup', async () => {
      await context.folderSetupFn(async (dir) => {
        const projectDir = path.join(dir, projectName)
        await Promise.all([fsp.mkdir(projectDir, { recursive: true })])
        await Promise.all([
          fsp.copyFile(
            executorInputPath('router-template-slate.kcl'),
            path.join(projectDir, 'main.kcl')
          ),
        ])
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
})

test(`Create a few projects
using the
default project name`, async ({ homePage, toolbar }) => {
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
})

test(
  'File in the file pane should open with a single click',
  { tag: '@desktop' },
  async ({ context, homePage, page, scene, toolbar }, testInfo) => {
    const projectName = 'router-template-slate'
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(`${dir}/${projectName}`, { recursive: true })
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/router-template-slate.kcl',
        `${dir}/${projectName}/main.kcl`
      )
      await fsp.copyFile(
        'rust/kcl-lib/e2e/executor/inputs/focusrite_scarlett_mounting_bracket.kcl',
        `${dir}/${projectName}/otherThingToClickOn.kcl`
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

    await page.getByRole('button', { name: 'Project Files' }).click()
    await toolbar.openFile('otherThingToClickOn.kcl')

    await expect(u.codeLocator).toContainText(
      'A mounting bracket for the Focusrite Scarlett Solo audio interface'
    )
  }
)

test(
  'Nested directories in project without main.kcl do not create main.kcl',
  {
    tag: '@desktop',
  },
  async ({ scene, cmdBar, context, page }, testInfo) => {
    let testDir: string | undefined
    await context.folderSetupFn(async (dir) => {
      await fsp.mkdir(path.join(dir, 'router-template-slate', 'nested'), {
        recursive: true,
      })
      await fsp.copyFile(
        executorInputPath('router-template-slate.kcl'),
        path.join(dir, 'router-template-slate', 'nested', 'slate.kcl')
      )
      await fsp.copyFile(
        executorInputPath('focusrite_scarlett_mounting_bracket.kcl'),
        path.join(dir, 'router-template-slate', 'nested', 'bracket.kcl')
      )
      testDir = dir
    })
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1200, height: 500 })

    page.on('console', console.log)

    await test.step('Open the project', async () => {
      await page.getByText('router-template-slate').click()
      await scene.settled(cmdBar)

      // It actually loads.
      await expect(u.codeLocator).toContainText('mounting bracket')
      await expect(u.codeLocator).toContainText('radius =')
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
      // eslint-disable-next-line jest/no-conditional-expect
      await expect(
        fsp.access(path.join(testDir, 'router-template-slate', 'main.kcl'))
      ).rejects.toThrow()
      // eslint-disable-next-line jest/no-conditional-expect
      await expect(
        fsp.access(
          path.join(testDir, 'router-template-slate', 'nested', 'main.kcl')
        )
      ).rejects.toThrow()
    }
  }
)

test(
  'Deleting projects, can delete individual project, can still create projects after deleting all',
  {
    tag: '@desktop',
  },
  async ({ context, page }, testInfo) => {
    const projectData = [
      ['router-template-slate', 'cylinder.kcl'],
      ['bracket', 'focusrite_scarlett_mounting_bracket.kcl'],
      ['lego', 'lego.kcl'],
    ]

    await context.folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fsp.mkdir(path.join(dir, name), { recursive: true })
        await fsp.copyFile(
          executorInputPath(file),
          path.join(dir, name, `main.kcl`)
        )
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
      await createProject({ name: 'new-project', page, returnHome: true })
      await expect(
        page.getByTestId('project-link').filter({ hasText: 'new-project' })
      ).toBeVisible()
    })
  }
)

test(
  'Can load a file with CRLF line endings',
  {
    tag: '@desktop',
  },
  async ({ context, page, scene, cmdBar }, testInfo) => {
    await context.folderSetupFn(async (dir) => {
      const routerTemplateDir = path.join(dir, 'router-template-slate')
      await fsp.mkdir(routerTemplateDir, { recursive: true })

      const file = await fsp.readFile(
        executorInputPath('router-template-slate.kcl'),
        'utf-8'
      )
      // Replace both \r optionally so we don't end up with \r\r\n
      const fileWithCRLF = file.replace(/\r?\n/g, '\r\n')
      await fsp.writeFile(
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
    tag: '@desktop',
  },
  async ({ context, page }, testInfo) => {
    const projectData = [
      ['router-template-slate', 'cylinder.kcl'],
      ['bracket', 'focusrite_scarlett_mounting_bracket.kcl'],
      ['lego', 'lego.kcl'],
    ]

    await context.folderSetupFn(async (dir) => {
      // Do these serially to ensure the order is correct
      for (const [name, file] of projectData) {
        await fsp.mkdir(path.join(dir, name), { recursive: true })
        await fsp.copyFile(
          executorInputPath(file),
          path.join(dir, name, `main.kcl`)
        )
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
