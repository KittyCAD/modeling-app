import { test, expect } from './zoo-test'
import * as fsp from 'fs/promises'
import * as fs from 'fs'
import {
  createProject,
  executorInputPath,
  getUtils,
  orRunWhenFullSuiteEnabled,
} from './test-utils'
import { join } from 'path'
import { FILE_EXT } from 'lib/constants'

test.describe('integrations tests', () => {
  test(
    'Creating a new file or switching file while in sketchMode should exit sketchMode',
    { tag: ['@electron', '@skipWin'] },
    async ({ page, context, homePage, scene, editor, toolbar, cmdBar }) => {
      await context.folderSetupFn(async (dir) => {
        const bracketDir = join(dir, 'test-sample')
        await fsp.mkdir(bracketDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
          join(bracketDir, 'main.kcl')
        )
      })

      const [clickObj] = await scene.makeMouseHelpers(726, 272)

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
      })
      await test.step('enter sketch mode', async () => {
        await scene.connectionEstablished()
        await scene.settled(cmdBar)
        await clickObj()
        await scene.moveNoWhere()
        await editor.expectState({
          activeLines: [
            '|>startProfileAt([75.8,317.2],%)//[$startCapTag,$EndCapTag]',
          ],
          highlightedCode: '',
          diagnostics: [],
        })
        await toolbar.editSketch()
        await expect(toolbar.exitSketchBtn).toBeVisible()
      })

      const fileName = 'Untitled.kcl'
      await test.step('check sketch mode is exited when creating new file', async () => {
        await toolbar.fileTreeBtn.click()
        await toolbar.expectFileTreeState(['main.kcl'])

        await toolbar.createFile({ fileName, waitForToastToDisappear: true })

        // check we're out of sketch mode
        await expect(toolbar.exitSketchBtn).not.toBeVisible()
        await expect(toolbar.startSketchBtn).toBeVisible()
      })
      await test.step('setup for next assertion', async () => {
        await toolbar.openFile('main.kcl')

        await scene.settled(cmdBar)

        await clickObj()
        await scene.moveNoWhere()
        await editor.expectState({
          activeLines: [
            '|>startProfileAt([75.8,317.2],%)//[$startCapTag,$EndCapTag]',
          ],
          highlightedCode: '',
          diagnostics: [],
        })
        await toolbar.editSketch()
        await expect(toolbar.exitSketchBtn).toBeVisible()
        await toolbar.expectFileTreeState(['main.kcl', fileName])
      })
      await test.step('check sketch mode is exited when opening a different file', async () => {
        await toolbar.openFile(fileName, { wait: false })

        // check we're out of sketch mode
        await expect(toolbar.exitSketchBtn).not.toBeVisible()
        await expect(toolbar.startSketchBtn).toBeVisible()
      })
    }
  )
})
test.describe('when using the file tree to', () => {
  const fromFile = 'main.kcl'
  const toFile = 'hello.kcl'

  test(
    `rename ${fromFile} to ${toFile}, and doesn't crash on reload and settings load`,
    { tag: '@electron' },
    async ({ page }, testInfo) => {
      // TODO: fix this test on windows after the electron migration
      test.skip(process.platform === 'win32', 'Skip on windows')
      const { panesOpen, pasteCodeInEditor, renameFile, editorTextMatches } =
        await getUtils(page, test)

      await page.setBodyDimensions({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files', 'code'])

      await createProject({ name: 'project-000', page })

      // File the main.kcl with contents
      const kclCube = await fsp.readFile(
        'rust/kcl-lib/e2e/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

      // TODO: We have a timeout of 1s between edits to write to disk. If you reload the page too quickly it won't write to disk.
      await page.waitForTimeout(2000)

      await renameFile(fromFile, toFile)
      await page.reload()

      await test.step('Postcondition: editor has same content as before the rename', async () => {
        await editorTextMatches(kclCube)
      })

      await test.step('Postcondition: opening and closing settings works', async () => {
        const settingsOpenButton = page.getByRole('link', {
          name: 'settings Settings',
        })
        const settingsCloseButton = page.getByTestId('settings-close-button')
        await settingsOpenButton.click()
        await settingsCloseButton.click()
      })
    }
  )

  test(
    `create many new files of the same name, incrementing their names`,
    { tag: '@electron' },
    async ({ page }, testInfo) => {
      // TODO: fix this test on windows after the electron migration
      test.skip(process.platform === 'win32', 'Skip on windows')
      const { panesOpen, createNewFile } = await getUtils(page, test)

      await page.setBodyDimensions({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files'])

      await createProject({ name: 'project-000', page })

      await createNewFile('lee')
      await createNewFile('lee')
      await createNewFile('lee')
      await createNewFile('lee')
      await createNewFile('lee')

      await test.step('Postcondition: there are 5 new lee-*.kcl files', async () => {
        await expect
          .poll(() =>
            page
              .locator('[data-testid="file-pane-scroll-container"] button')
              .filter({ hasText: /lee[-]?[0-5]?/ })
              .count()
          )
          .toEqual(5)
      })
    }
  )

  test(
    'create a new file with the same name as an existing file cancels the operation',
    { tag: '@electron' },
    async ({ context, page, homePage, scene, editor, toolbar }, testInfo) => {
      const projectName = 'cube'
      const mainFile = 'main.kcl'
      const secondFile = 'cylinder.kcl'
      const kclCube = await fsp.readFile(executorInputPath('cube.kcl'), 'utf-8')
      const kclCylinder = await fsp.readFile(
        executorInputPath('cylinder.kcl'),
        'utf-8'
      )

      await context.folderSetupFn(async (dir) => {
        const cubeDir = join(dir, projectName)
        await fsp.mkdir(cubeDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('cube.kcl'),
          join(cubeDir, mainFile)
        )
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(cubeDir, secondFile)
        )
      })

      const {
        openFilePanel,
        renameFile,
        selectFile,
        editorTextMatches,
        waitForPageLoad,
      } = await getUtils(page, test)

      await test.step(`Setup: Open project and navigate to ${secondFile}`, async () => {
        await homePage.expectState({
          projectCards: [
            {
              title: projectName,
              fileCount: 2,
            },
          ],
          sortBy: 'last-modified-desc',
        })
        await homePage.openProject(projectName)
        await waitForPageLoad()
        await openFilePanel()
        await selectFile(secondFile)
      })

      await test.step(`Attempt to rename ${secondFile} to ${mainFile}`, async () => {
        await renameFile(secondFile, mainFile)
      })

      await test.step(`Postcondition: ${mainFile} still has the original content`, async () => {
        await selectFile(mainFile)
        await editorTextMatches(kclCube)
      })

      await test.step(`Postcondition: ${secondFile} still exists with the original content`, async () => {
        await selectFile(secondFile)
        await editorTextMatches(kclCylinder)
      })
    }
  )

  test(
    'deleting all files recreates a default main.kcl with no code',
    { tag: '@electron' },
    async ({ page }, testInfo) => {
      const { panesOpen, pasteCodeInEditor, deleteFile, editorTextMatches } =
        await getUtils(page, test)

      await page.setBodyDimensions({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files', 'code'])

      await createProject({ name: 'project-000', page })
      // File the main.kcl with contents
      const kclCube = await fsp.readFile(
        'rust/kcl-lib/e2e/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

      const mainFile = 'main.kcl'

      await deleteFile(mainFile)

      await test.step(`Postcondition: ${mainFile} is recreated but has no content`, async () => {
        await editorTextMatches('')
      })
    }
  )

  test(
    'loading small file, then large, then back to small',
    {
      tag: '@electron',
    },
    async ({ page }, testInfo) => {
      test.fixme(orRunWhenFullSuiteEnabled())
      const {
        panesOpen,
        pasteCodeInEditor,
        createNewFile,
        openDebugPanel,
        closeDebugPanel,
        expectCmdLog,
      } = await getUtils(page, test)

      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files', 'code'])
      await createProject({ name: 'project-000', page })

      // Create a small file
      const kclCube = await fsp.readFile(
        'rust/kcl-lib/e2e/executor/inputs/cube.kcl',
        'utf-8'
      )
      // pasted into main.kcl
      await pasteCodeInEditor(kclCube)

      // Create a large lego file
      await createNewFile('lego')
      const legoFile = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: 'lego.kcl' }),
      })
      await expect(legoFile).toBeVisible({ timeout: 60_000 })
      await legoFile.click()
      const kclLego = await fsp.readFile(
        'rust/kcl-lib/e2e/executor/inputs/lego.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclLego)
      const mainFile = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: 'main.kcl' }),
      })

      // Open settings and enable the debug panel
      await page
        .getByRole('link', {
          name: 'settings Settings',
        })
        .click()
      await page.locator('#showDebugPanel').getByText('OffOn').click()
      await page.getByTestId('settings-close-button').click()

      await test.step('swap between small and large files', async () => {
        await openDebugPanel()
        // Previously created a file so we need to start back at main.kcl
        await mainFile.click()
        await expectCmdLog('[data-message-type="execution-done"]', 60_000)
        // Click the large file
        await legoFile.click()
        // Once it is building, click back to the smaller file
        await mainFile.click()
        await expectCmdLog('[data-message-type="execution-done"]', 60_000)
        await closeDebugPanel()
      })
    }
  )
})

test.describe('Renaming in the file tree', () => {
  test(
    'A file you have open',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const { dir } = await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(dir, 'Test Project', 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(dir, 'Test Project', 'fileToRename.kcl')
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const checkUnRenamedFS = () => {
        const filePath = join(dir, 'Test Project', 'fileToRename.kcl')
        return fs.existsSync(filePath)
      }
      const newFileName = 'newFileName'
      const checkRenamedFS = () => {
        const filePath = join(dir, 'Test Project', `${newFileName}.kcl`)
        return fs.existsSync(filePath)
      }

      const fileToRename = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'fileToRename.kcl' }) })
      const renamedFile = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'newFileName.kcl' }) })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const renameInput = page.getByPlaceholder('fileToRename.kcl')
      const codeLocator = page.locator('.cm-content')

      await test.step('Open project and file pane', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        await u.openFilePanel()
        await expect(fileToRename).toBeVisible()
        expect(checkUnRenamedFS()).toBeTruthy()
        expect(checkRenamedFS()).toBeFalsy()
        await fileToRename.click()
        await expect(projectMenuButton).toContainText('fileToRename.kcl')
        await u.openKclCodePanel()
        await expect(codeLocator).toContainText('circle(')
        await u.closeKclCodePanel()
      })

      await test.step('Rename the file', async () => {
        await fileToRename.click({ button: 'right' })
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFileName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the file is renamed', async () => {
        await expect(fileToRename).not.toBeAttached()
        await expect(renamedFile).toBeVisible()
        expect(checkUnRenamedFS()).toBeFalsy()
        expect(checkRenamedFS()).toBeTruthy()
      })

      await test.step('Verify we navigated', async () => {
        await expect(projectMenuButton).toContainText(newFileName + FILE_EXT)
        const url = page.url()
        expect(url).toContain(newFileName)
        await expect(projectMenuButton).not.toContainText('fileToRename.kcl')
        await expect(projectMenuButton).not.toContainText('main.kcl')
        expect(url).not.toContain('fileToRename.kcl')
        expect(url).not.toContain('main.kcl')

        await u.openKclCodePanel()
        await expect(codeLocator).toContainText('circle(')
      })
    }
  )

  test(
    'A file you do not have open',
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const { dir } = await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(dir, 'Test Project', 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(dir, 'Test Project', 'fileToRename.kcl')
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const newFileName = 'newFileName'
      const checkUnRenamedFS = () => {
        const filePath = join(dir, 'Test Project', 'fileToRename.kcl')
        return fs.existsSync(filePath)
      }
      const checkRenamedFS = () => {
        const filePath = join(dir, 'Test Project', `${newFileName}.kcl`)
        return fs.existsSync(filePath)
      }
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const fileToRename = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'fileToRename.kcl' }) })
      const renamedFile = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: newFileName + FILE_EXT }),
      })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const renameInput = page.getByPlaceholder('fileToRename.kcl')
      const codeLocator = page.locator('.cm-content')

      await test.step('Open project and file pane', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        await u.openFilePanel()
        await expect(fileToRename).toBeVisible()
        expect(checkUnRenamedFS()).toBeTruthy()
        expect(checkRenamedFS()).toBeFalsy()
      })

      await test.step('Rename the file', async () => {
        await fileToRename.click({ button: 'right' })
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFileName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the file is renamed', async () => {
        await expect(fileToRename).not.toBeAttached()
        await expect(renamedFile).toBeVisible()
        expect(checkUnRenamedFS()).toBeFalsy()
        expect(checkRenamedFS()).toBeTruthy()
      })

      await test.step('Verify we have not navigated', async () => {
        await expect(projectMenuButton).toContainText('main.kcl')
        await expect(projectMenuButton).not.toContainText(
          newFileName + FILE_EXT
        )
        await expect(projectMenuButton).not.toContainText('fileToRename.kcl')

        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain(newFileName)
        expect(url).not.toContain('fileToRename.kcl')

        await u.openKclCodePanel()
        await expect(codeLocator).toContainText('fillet(')
      })
    }
  )

  test(
    `A folder you're not inside`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const { dir } = await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
        await fsp.mkdir(join(dir, 'Test Project', 'folderToRename'), {
          recursive: true,
        })
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(dir, 'Test Project', 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(dir, 'Test Project', 'folderToRename', 'someFileWithin.kcl')
        )
      })

      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToRename = page.getByRole('button', {
        name: 'folderToRename',
      })
      const renamedFolder = page.getByRole('button', { name: 'newFolderName' })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const originalFolderName = 'folderToRename'
      const renameInput = page.getByPlaceholder(originalFolderName)
      const newFolderName = 'newFolderName'
      const checkUnRenamedFolderFS = () => {
        const folderPath = join(dir, 'Test Project', originalFolderName)
        return fs.existsSync(folderPath)
      }
      const checkRenamedFolderFS = () => {
        const folderPath = join(dir, 'Test Project', newFolderName)
        return fs.existsSync(folderPath)
      }

      await test.step('Open project and file pane', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain('folderToRename')

        await u.openFilePanel()
        await expect(folderToRename).toBeVisible()
        expect(checkUnRenamedFolderFS()).toBeTruthy()
        expect(checkRenamedFolderFS()).toBeFalsy()
      })

      await test.step('Rename the folder', async () => {
        await folderToRename.click({ button: 'right' })
        await expect(renameMenuItem).toBeVisible()
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFolderName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the folder is renamed, and no navigation occurred', async () => {
        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain('folderToRename')

        await expect(projectMenuButton).toContainText('main.kcl')
        await expect(renamedFolder).toBeVisible()
        await expect(folderToRename).not.toBeAttached()
        expect(checkUnRenamedFolderFS()).toBeFalsy()
        expect(checkRenamedFolderFS()).toBeTruthy()
      })
    }
  )

  test(
    `A folder you are inside`,
    { tag: '@electron' },
    async ({ page, context }, testInfo) => {
      const { dir } = await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
        await fsp.mkdir(join(dir, 'Test Project', 'folderToRename'), {
          recursive: true,
        })
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(dir, 'Test Project', 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(dir, 'Test Project', 'folderToRename', 'someFileWithin.kcl')
        )
      })

      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectLink = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToRename = page.getByRole('button', {
        name: 'folderToRename',
      })
      const renamedFolder = page.getByRole('button', { name: 'newFolderName' })
      const fileWithinFolder = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: 'someFileWithin.kcl' }),
      })
      const renameMenuItem = page.getByRole('button', { name: 'Rename' })
      const originalFolderName = 'folderToRename'
      const renameInput = page.getByPlaceholder(originalFolderName)
      const newFolderName = 'newFolderName'
      const checkUnRenamedFolderFS = () => {
        const folderPath = join(dir, 'Test Project', originalFolderName)
        return fs.existsSync(folderPath)
      }
      const checkRenamedFolderFS = () => {
        const folderPath = join(dir, 'Test Project', newFolderName)
        return fs.existsSync(folderPath)
      }

      await test.step('Open project and navigate into folder', async () => {
        await expect(projectLink).toBeVisible()
        await projectLink.click()
        await expect(projectMenuButton).toBeVisible()
        await expect(projectMenuButton).toContainText('main.kcl')

        const url = page.url()
        expect(url).toContain('main.kcl')
        expect(url).not.toContain('folderToRename')

        await u.openFilePanel()
        await expect(folderToRename).toBeVisible()
        await folderToRename.click()
        await expect(fileWithinFolder).toBeVisible()
        await fileWithinFolder.click()

        await expect(projectMenuButton).toContainText('someFileWithin.kcl')
        const newUrl = page.url()
        expect(newUrl).toContain('folderToRename')
        expect(newUrl).toContain('someFileWithin.kcl')
        expect(newUrl).not.toContain('main.kcl')
        expect(checkUnRenamedFolderFS()).toBeTruthy()
        expect(checkRenamedFolderFS()).toBeFalsy()
      })

      await test.step('Rename the folder', async () => {
        await page.waitForTimeout(1000)
        await folderToRename.click({ button: 'right' })
        await expect(renameMenuItem).toBeVisible()
        await renameMenuItem.click()
        await expect(renameInput).toBeVisible()
        await renameInput.fill(newFolderName)
        await page.keyboard.press('Enter')
      })

      await test.step('Verify the folder is renamed, and navigated to new path', async () => {
        const urlSnippet = encodeURIComponent(
          join(newFolderName, 'someFileWithin.kcl')
        )
        await page.waitForURL(new RegExp(urlSnippet))
        await expect(projectMenuButton).toContainText('someFileWithin.kcl')
        await expect(renamedFolder).toBeVisible()
        await expect(folderToRename).not.toBeAttached()

        // URL is synchronous, so we check the other stuff first
        const url = page.url()
        expect(url).not.toContain('main.kcl')
        expect(url).toContain(newFolderName)
        expect(url).toContain('someFileWithin.kcl')
        expect(checkUnRenamedFolderFS()).toBeFalsy()
        expect(checkRenamedFolderFS()).toBeTruthy()
      })
    }
  )
})

test.describe('Deleting items from the file pane', () => {
  test(
    `delete file when main.kcl exists, navigate to main.kcl`,
    { tag: '@electron' },
    async ({ page, context }, testInfo) => {
      await context.folderSetupFn(async (dir) => {
        const testDir = join(dir, 'testProject')
        await fsp.mkdir(testDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(testDir, 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(testDir, 'fileToDelete.kcl')
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectCard = page.getByText('testProject')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const fileToDelete = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'fileToDelete.kcl' }) })
      const deleteMenuItem = page.getByRole('button', { name: 'Delete' })
      const deleteConfirmation = page.getByTestId('delete-confirmation')

      await test.step('Open project and navigate to fileToDelete.kcl', async () => {
        await projectCard.click()
        await u.waitForPageLoad()
        await u.openFilePanel()

        await fileToDelete.click()
        await u.waitForPageLoad()
        await u.openKclCodePanel()
        await expect(u.codeLocator).toContainText('getOppositeEdge(thing)')
        await u.closeKclCodePanel()
      })

      await test.step('Delete fileToDelete.kcl', async () => {
        await fileToDelete.click({ button: 'right' })
        await expect(deleteMenuItem).toBeVisible()
        await deleteMenuItem.click()
        await expect(deleteConfirmation).toBeVisible()
        await deleteConfirmation.click()
      })

      await test.step('Check deletion and navigation', async () => {
        await u.waitForPageLoad()
        await expect(fileToDelete).not.toBeVisible()
        await u.closeFilePanel()
        await u.openKclCodePanel()
        await expect(u.codeLocator).toContainText('circle(')
        await expect(projectMenuButton).toContainText('main.kcl')
      })
    }
  )

  test.fixme(
    'TODO - delete file we have open when main.kcl does not exist',
    async () => {}
  )

  test(
    `Delete folder we are not in, don't navigate`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
        await fsp.mkdir(join(dir, 'Test Project', 'folderToDelete'), {
          recursive: true,
        })
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(dir, 'Test Project', 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(dir, 'Test Project', 'folderToDelete', 'someFileWithin.kcl')
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectCard = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToDelete = page.getByRole('button', {
        name: 'folderToDelete',
      })
      const deleteMenuItem = page.getByRole('button', { name: 'Delete' })
      const deleteConfirmation = page.getByTestId('delete-confirmation')

      await test.step('Open project and open project pane', async () => {
        await projectCard.click()
        await u.waitForPageLoad()
        await expect(projectMenuButton).toContainText('main.kcl')
        await u.closeKclCodePanel()
        await u.openFilePanel()
      })

      await test.step('Delete folderToDelete', async () => {
        await folderToDelete.click({ button: 'right' })
        await expect(deleteMenuItem).toBeVisible()
        await deleteMenuItem.click()
        await expect(deleteConfirmation).toBeVisible()
        await deleteConfirmation.click()
      })

      await test.step('Check deletion and no navigation', async () => {
        await expect(folderToDelete).not.toBeAttached()
        await expect(projectMenuButton).toContainText('main.kcl')
      })
    }
  )

  test(
    `Delete folder we are in, navigate to main.kcl`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      await context.folderSetupFn(async (dir) => {
        await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
        await fsp.mkdir(join(dir, 'Test Project', 'folderToDelete'), {
          recursive: true,
        })
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(dir, 'Test Project', 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(dir, 'Test Project', 'folderToDelete', 'someFileWithin.kcl')
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectCard = page.getByText('Test Project')
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToDelete = page.getByRole('button', {
        name: 'folderToDelete',
      })
      const fileWithinFolder = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: 'someFileWithin.kcl' }),
      })
      const deleteMenuItem = page.getByRole('button', { name: 'Delete' })
      const deleteConfirmation = page.getByTestId('delete-confirmation')

      await test.step('Open project and navigate into folderToDelete', async () => {
        await projectCard.click()
        await u.waitForPageLoad()
        await expect(projectMenuButton).toContainText('main.kcl')
        await u.closeKclCodePanel()
        await u.openFilePanel()

        await folderToDelete.click()
        await expect(fileWithinFolder).toBeVisible()
        await fileWithinFolder.click()
        await expect(projectMenuButton).toContainText('someFileWithin.kcl')
      })

      await test.step('Delete folderToDelete', async () => {
        await folderToDelete.click({ button: 'right' })
        await expect(deleteMenuItem).toBeVisible()
        await deleteMenuItem.click()
        await expect(deleteConfirmation).toBeVisible()
        await deleteConfirmation.click()
      })

      await test.step('Check deletion and navigation to main.kcl', async () => {
        await expect(folderToDelete).not.toBeAttached()
        await expect(fileWithinFolder).not.toBeAttached()
        await expect(projectMenuButton).toContainText('main.kcl')
      })
    }
  )

  test.fixme('TODO - delete folder we are in, with no main.kcl', async () => {})

  // Copied from tests above.
  test(
    `external deletion of project navigates back home`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const TEST_PROJECT_NAME = 'Test Project'
      const { dir: projectsDirName } = await context.folderSetupFn(
        async (dir) => {
          await fsp.mkdir(join(dir, TEST_PROJECT_NAME), { recursive: true })
          await fsp.mkdir(join(dir, TEST_PROJECT_NAME, 'folderToDelete'), {
            recursive: true,
          })
          await fsp.copyFile(
            executorInputPath('basic_fillet_cube_end.kcl'),
            join(dir, TEST_PROJECT_NAME, 'main.kcl')
          )
          await fsp.copyFile(
            executorInputPath('cylinder.kcl'),
            join(dir, TEST_PROJECT_NAME, 'folderToDelete', 'someFileWithin.kcl')
          )
        }
      )
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      // Constants and locators
      const projectCard = page.getByText(TEST_PROJECT_NAME)
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToDelete = page.getByRole('button', {
        name: 'folderToDelete',
      })
      const fileWithinFolder = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: 'someFileWithin.kcl' }),
      })

      await test.step('Open project and navigate into folderToDelete', async () => {
        await projectCard.click()
        await u.waitForPageLoad()
        await expect(projectMenuButton).toContainText('main.kcl')
        await u.closeKclCodePanel()
        await u.openFilePanel()

        await folderToDelete.click()
        await expect(fileWithinFolder).toBeVisible()
        await fileWithinFolder.click()
        await expect(projectMenuButton).toContainText('someFileWithin.kcl')
      })

      // Point of divergence. Delete the project folder and see if it goes back
      // to the home view.
      await test.step('Delete projectsDirName/<project-name> externally', async () => {
        await fsp.rm(join(projectsDirName, TEST_PROJECT_NAME), {
          recursive: true,
          force: true,
        })
      })

      await test.step('Check the app is back on the home view', async () => {
        const projectsDirLink = page.getByText('Loaded from')
        await expect(projectsDirLink).toBeVisible()
      })
    }
  )

  // Similar to the above
  test(
    `external deletion of file in sub-directory updates the file tree and recreates it on code editor typing`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      const TEST_PROJECT_NAME = 'Test Project'
      const { dir: projectsDirName } = await context.folderSetupFn(
        async (dir) => {
          await fsp.mkdir(join(dir, TEST_PROJECT_NAME), { recursive: true })
          await fsp.mkdir(join(dir, TEST_PROJECT_NAME, 'folderToDelete'), {
            recursive: true,
          })
          await fsp.copyFile(
            executorInputPath('basic_fillet_cube_end.kcl'),
            join(dir, TEST_PROJECT_NAME, 'main.kcl')
          )
          await fsp.copyFile(
            executorInputPath('cylinder.kcl'),
            join(dir, TEST_PROJECT_NAME, 'folderToDelete', 'someFileWithin.kcl')
          )
        }
      )
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })

      // Constants and locators
      const projectCard = page.getByText(TEST_PROJECT_NAME)
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const folderToDelete = page.getByRole('button', {
        name: 'folderToDelete',
      })
      const fileWithinFolder = page.getByRole('listitem').filter({
        has: page.getByRole('button', { name: 'someFileWithin.kcl' }),
      })

      await test.step('Open project and navigate into folderToDelete', async () => {
        await projectCard.click()
        await u.waitForPageLoad()
        await expect(projectMenuButton).toContainText('main.kcl')

        await u.openFilePanel()

        await folderToDelete.click()
        await expect(fileWithinFolder).toBeVisible()
        await fileWithinFolder.click()
        await expect(projectMenuButton).toContainText('someFileWithin.kcl')
      })

      await test.step('Delete projectsDirName/<project-name> externally', async () => {
        await fsp.rm(
          join(
            projectsDirName,
            TEST_PROJECT_NAME,
            'folderToDelete',
            'someFileWithin.kcl'
          )
        )
      })

      await test.step('Check the file is gone in the file tree', async () => {
        await expect(
          page.getByTestId('file-pane-scroll-container')
        ).not.toContainText('someFileWithin.kcl')
      })

      await test.step('Check the file is back in the file tree after typing in code editor', async () => {
        await u.pasteCodeInEditor('hello = 1')
        await expect(
          page.getByTestId('file-pane-scroll-container')
        ).toContainText('someFileWithin.kcl')
      })
    }
  )
})

test.describe('Undo and redo do not keep history when navigating between files', () => {
  test(
    `open a file, change something, open a different file, hitting undo should do nothing`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      // TODO: fix this test on windows after the electron migration
      test.skip(process.platform === 'win32', 'Skip on windows')
      await context.folderSetupFn(async (dir) => {
        const testDir = join(dir, 'testProject')
        await fsp.mkdir(testDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(testDir, 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(testDir, 'other.kcl')
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectCard = page.getByText('testProject')
      const otherFile = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'other.kcl' }) })

      await test.step('Open project and make a change to the file', async () => {
        await projectCard.click()
        await u.waitForPageLoad()

        // Get the text in the code locator.
        const originalText = await u.codeLocator.innerText()
        // Click in the editor and add some new lines.
        await u.codeLocator.click()

        await page.keyboard.type(`sketch001 = startSketchOn(XY)
    some other shit`)

        // Ensure the content in the editor changed.
        const newContent = await u.codeLocator.innerText()

        expect(originalText !== newContent)
      })

      await test.step('navigate to other.kcl', async () => {
        await u.openFilePanel()

        await otherFile.click()
        await u.waitForPageLoad()
        await u.openKclCodePanel()
        await expect(u.codeLocator).toContainText('getOppositeEdge(thing)')
      })

      await test.step('hit undo', async () => {
        // Get the original content of the file.
        const originalText = await u.codeLocator.innerText()
        // Now hit undo
        await page.keyboard.down('ControlOrMeta')
        await page.keyboard.press('KeyZ')
        await page.keyboard.up('ControlOrMeta')

        await page.waitForTimeout(100)
        await expect(u.codeLocator).toContainText(originalText)
      })
    }
  )

  test(
    `open a file, change something, undo it, open a different file, hitting redo should do nothing`,
    { tag: '@electron' },
    // Skip on windows i think the keybindings are different for redo.
    async ({ context, page }, testInfo) => {
      // TODO: fix this test on windows after the electron migration
      test.skip(process.platform === 'win32', 'Skip on windows')
      await context.folderSetupFn(async (dir) => {
        const testDir = join(dir, 'testProject')
        await fsp.mkdir(testDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('cylinder.kcl'),
          join(testDir, 'main.kcl')
        )
        await fsp.copyFile(
          executorInputPath('basic_fillet_cube_end.kcl'),
          join(testDir, 'other.kcl')
        )
      })
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      // Constants and locators
      const projectCard = page.getByText('testProject')
      const otherFile = page
        .getByRole('listitem')
        .filter({ has: page.getByRole('button', { name: 'other.kcl' }) })

      const badContent = 'this shit'
      await test.step('Open project and make a change to the file', async () => {
        await projectCard.click()
        await u.waitForPageLoad()

        // Get the text in the code locator.
        const originalText = await u.codeLocator.innerText()
        // Click in the editor and add some new lines.
        await u.codeLocator.click()

        await page.keyboard.type(badContent)

        // Ensure the content in the editor changed.
        const newContent = await u.codeLocator.innerText()

        expect(originalText !== newContent)

        // Now hit undo
        await page.keyboard.down('ControlOrMeta')
        await page.keyboard.press('KeyZ')
        await page.keyboard.up('ControlOrMeta')

        await page.waitForTimeout(100)
        await expect(u.codeLocator).toContainText(originalText)
        await expect(u.codeLocator).not.toContainText(badContent)

        // Hit redo.
        await page.keyboard.down('Shift')
        await page.keyboard.down('ControlOrMeta')
        await page.keyboard.press('KeyZ')
        await page.keyboard.up('ControlOrMeta')
        await page.keyboard.up('Shift')

        await page.waitForTimeout(100)
        await expect(u.codeLocator).toContainText(originalText)
        await expect(u.codeLocator).toContainText(badContent)

        // Now hit undo
        await page.keyboard.down('ControlOrMeta')
        await page.keyboard.press('KeyZ')
        await page.keyboard.up('ControlOrMeta')

        await page.waitForTimeout(100)
        await expect(u.codeLocator).toContainText(originalText)
        await expect(u.codeLocator).not.toContainText(badContent)
      })

      await test.step('navigate to other.kcl', async () => {
        await u.openFilePanel()

        await otherFile.click()
        await u.waitForPageLoad()
        await u.openKclCodePanel()
        await expect(u.codeLocator).toContainText('getOppositeEdge(thing)')
        await expect(u.codeLocator).not.toContainText(badContent)
      })

      await test.step('hit redo', async () => {
        // Get the original content of the file.
        const originalText = await u.codeLocator.innerText()
        // Now hit redo
        await page.keyboard.down('Shift')
        await page.keyboard.down('ControlOrMeta')
        await page.keyboard.press('KeyZ')
        await page.keyboard.up('ControlOrMeta')
        await page.keyboard.up('Shift')

        await page.waitForTimeout(100)
        await expect(u.codeLocator).toContainText(originalText)
        await expect(u.codeLocator).not.toContainText(badContent)
      })
    }
  )

  test(
    `cloned file has an incremented name and same contents`,
    { tag: '@electron' },
    async ({ page, context, homePage }, testInfo) => {
      const { panesOpen, cloneFile } = await getUtils(page, test)

      const { dir } = await context.folderSetupFn(async (dir) => {
        const finalDir = join(dir, 'testDefault')
        await fsp.mkdir(finalDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
          join(finalDir, 'lee.kcl')
        )
      })

      const contentOriginal = await fsp.readFile(
        join(dir, 'testDefault', 'lee.kcl'),
        'utf-8'
      )

      await page.setBodyDimensions({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files'])
      await homePage.openProject('testDefault')

      await cloneFile('lee.kcl')
      await cloneFile('lee-1.kcl')
      await cloneFile('lee-2.kcl')
      await cloneFile('lee-3.kcl')
      await cloneFile('lee-4.kcl')

      await test.step('Postcondition: there are 5 new lee-*.kcl files', async () => {
        await expect(
          page
            .locator('[data-testid="file-pane-scroll-container"] button')
            .filter({ hasText: /lee[-]?[0-5]?/ })
        ).toHaveCount(5)
      })

      await test.step('Postcondition: the files have the same contents', async () => {
        for (let n = 0; n < 5; n += 1) {
          const content = await fsp.readFile(
            join(dir, 'testDefault', `lee-${n + 1}.kcl`),
            'utf-8'
          )
          await expect(content).toEqual(contentOriginal)
        }
      })
    }
  )
})
