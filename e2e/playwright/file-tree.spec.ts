import * as fs from 'fs'
import { join } from 'path'
import { FILE_EXT } from '@src/lib/constants'
import * as fsp from 'fs/promises'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

import {
  createProject,
  executorInputPath,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('integrations tests', { tag: '@desktop' }, () => {
  test('Creating a new file or switching file while in sketchMode should exit sketchMode', async ({
    page,
    context,
    homePage,
    scene,
    toolbar,
    cmdBar,
  }) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = join(dir, 'test-sample')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
        join(bracketDir, 'main.kcl')
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
      await scene.connectionEstablished()
      await scene.settled(cmdBar)
    })

    await toolbar.editSketch()

    const fileName = 'Untitled.kcl'
    await test.step('check sketch mode is exited when creating new file', async () => {
      await toolbar.openPane(DefaultLayoutPaneID.Files)
      await toolbar.expectFileTreeState(['main.kcl'])

      await toolbar.createFile({ fileName, waitForToastToDisappear: true })

      // check we're out of sketch mode
      await expect(toolbar.exitSketchBtn).not.toBeVisible()
      await expect(toolbar.startSketchBtn).toBeVisible()
    })
    await test.step('setup for next assertion', async () => {
      await toolbar.openFile('main.kcl')
      await page.waitForTimeout(2000)
      await toolbar.editSketch()
      await toolbar.expectFileTreeState(['main.kcl', fileName])
    })
    await test.step('check sketch mode is exited when opening a different file', async () => {
      await toolbar.openFile(fileName)

      // check we're out of sketch mode
      await expect(toolbar.exitSketchBtn).not.toBeVisible()
      await expect(toolbar.startSketchBtn).toBeVisible()
    })
  })
})
test.describe('when using the file tree to', { tag: '@desktop' }, () => {
  const fromFile = 'main.kcl'
  const toFile = 'hello.kcl'

  test(`rename ${fromFile} to ${toFile}, and doesn't crash on reload and settings load`, async ({
    page,
  }, testInfo) => {
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
  })

  test('create a new file with the same name as an existing file cancels the operation', async ({
    context,
    page,
    homePage,
    scene,
    editor,
    toolbar,
  }, testInfo) => {
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
      await fsp.copyFile(executorInputPath('cube.kcl'), join(cubeDir, mainFile))
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
  })

  test(
    `create new folders and that doesn't trigger a navigation`,
    { tag: ['@macos', '@windows'] },
    async ({ page, homePage, scene, toolbar, cmdBar }) => {
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await toolbar.openPane(DefaultLayoutPaneID.Files)
      const { createNewFolder } = await getUtils(page, test)

      await createNewFolder('folder')

      await createNewFolder('folder.kcl')

      await test.step(`Postcondition: folders are created and we didn't navigate`, async () => {
        await toolbar.expectFileTreeState(['folder', 'folder.kcl', 'main.kcl'])
        await expect(toolbar.fileName).toHaveText('main.kcl')
      })
    }
  )

  test('deleting all files recreates a default main.kcl with no code', async ({
    page,
  }, testInfo) => {
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
  })

  test('loading small file, then large, then back to small', async ({
    page,
    toolbar,
  }, testInfo) => {
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
    const kclLego = await fsp.readFile(
      'rust/kcl-lib/e2e/executor/inputs/lego.kcl',
      'utf-8'
    )
    await pasteCodeInEditor(kclLego)

    await test.step('swap between small and large files', async () => {
      await openDebugPanel()
      // Previously created a file so we need to start back at main.kcl
      await toolbar.openFile('main.kcl')
      await expectCmdLog('[data-message-type="execution-done"]', 60_000)
      // Click the large file
      await toolbar.openFile('lego.kcl')
      // Once it is building, click back to the smaller file
      await toolbar.openFile('main.kcl')
      await expectCmdLog('[data-message-type="execution-done"]', 60_000)
      await closeDebugPanel()
    })
  })
})

test.describe('Renaming in the file tree', { tag: '@desktop' }, () => {
  test('A file you have open', async ({ context, page }, testInfo) => {
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
    const fileToRename = u.locatorFile('fileToRename.kcl')
    const renamedFile = u.locatorFile('newFileName.kcl')
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
  })

  test('A file you do not have open', async ({ context, page }, testInfo) => {
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
    const fileToRename = u.locatorFile('fileToRename.kcl')
    const renamedFile = u.locatorFile(newFileName + FILE_EXT)
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
      await expect(projectMenuButton).not.toContainText(newFileName + FILE_EXT)
      await expect(projectMenuButton).not.toContainText('fileToRename.kcl')

      const url = page.url()
      expect(url).toContain('main.kcl')
      expect(url).not.toContain(newFileName)
      expect(url).not.toContain('fileToRename.kcl')

      await u.openKclCodePanel()
      await expect(codeLocator).toContainText('fillet(')
    })
  })

  test(`A folder you're not inside`, async ({ context, page }, testInfo) => {
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
    const folderToRename = u.locatorFolder('folderToRename')
    const renamedFolder = u.locatorFolder('newFolderName')
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
  })

  test(`A folder you are inside`, async ({ page, context }, testInfo) => {
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
    const folderToRename = u.locatorFolder('folderToRename')
    const renamedFolder = u.locatorFolder('newFolderName')
    const fileWithinFolder = u.locatorFile('someFileWithin.kcl')
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
  })
})

test.describe('Deleting items from the file pane', { tag: '@desktop' }, () => {
  test(`delete file when main.kcl exists, navigate to main.kcl`, async ({
    page,
    context,
  }, testInfo) => {
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
    const fileToDelete = u.locatorFile('fileToDelete.kcl')
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
  })

  test(`Delete folder we are not in, don't navigate`, async ({
    context,
    page,
  }, testInfo) => {
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
    const folderToDelete = u.locatorFolder('folderToDelete')
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
  })

  test(`Delete folder we are in, navigate to main.kcl`, async ({
    context,
    page,
  }, testInfo) => {
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
    const folderToDelete = u.locatorFolder('folderToDelete')
    const fileWithinFolder = u.locatorFile('someFileWithin.kcl')
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
  })

  // Copied from tests above.
  test(`external deletion of project navigates back home`, async ({
    context,
    page,
  }, testInfo) => {
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
    const folderToDelete = u.locatorFolder('folderToDelete')
    const fileWithinFolder = u.locatorFile('someFileWithin.kcl')

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
  })
})

test.describe('Drag and drop moves are undoable', { tag: '@desktop' }, () => {
  test('dragging a file moves it and undo restores it', async ({
    context,
    page,
    homePage,
    toolbar,
    editor,
  }) => {
    await context.folderSetupFn(async (dir) => {
      const projectDir = join(dir, 'Drag File Project')
      await fsp.mkdir(join(projectDir, 'target'), { recursive: true })
      await fsp.copyFile(
        executorInputPath('basic_fillet_cube_end.kcl'),
        join(projectDir, 'main.kcl')
      )
      await fsp.copyFile(
        executorInputPath('cylinder.kcl'),
        join(projectDir, 'fileToMove.kcl')
      )
    })

    const u = await getUtils(page)

    const fileToMove = u.locatorFile('fileToMove.kcl')
    const targetFolder = u.locatorFolder('target')

    await homePage.openProject('Drag File Project')
    await u.openFilePanel()

    await expect(fileToMove).toBeVisible()
    await expect(targetFolder).toBeVisible()

    await test.step('Move and ensure that the file lands where it should', async () => {
      await fileToMove.dragTo(targetFolder)

      await toolbar.ensureFolderOpen(targetFolder, true)
      await expect(u.locatorFile('fileToMove.kcl')).toBeVisible()
      await toolbar.ensureFolderOpen(targetFolder, false)
      await expect(fileToMove).not.toBeAttached()
    })

    await test.step('Undo and ensure the file returns and has content', async () => {
      await page.keyboard.down('ControlOrMeta')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('ControlOrMeta')

      await expect(fileToMove).toBeVisible()
      await toolbar.openFile('fileToMove.kcl')
      await expect(editor.codeContent).toContainText('circle')
    })
  })

  test('dragging a folder moves it and undo restores it', async ({
    context,
    page,
    homePage,
    toolbar,
    editor,
  }) => {
    await context.folderSetupFn(async (dir) => {
      const projectDir = join(dir, 'Drag Folder Project')
      await fsp.mkdir(join(projectDir, 'folderToMove'), { recursive: true })
      await fsp.mkdir(join(projectDir, 'targetFolder'), { recursive: true })
      await fsp.copyFile(
        executorInputPath('basic_fillet_cube_end.kcl'),
        join(projectDir, 'main.kcl')
      )
      await fsp.copyFile(
        executorInputPath('cylinder.kcl'),
        join(projectDir, 'folderToMove', 'inside.kcl')
      )
    })

    const u = await getUtils(page)

    const folderToMove = u.locatorFolder('folderToMove')
    const targetFolder = u.locatorFolder('targetFolder')
    const movedFile = u.locatorFile('inside.kcl')

    await homePage.openProject('Drag Folder Project')
    await u.openFilePanel()

    await expect(folderToMove).toBeVisible()
    await expect(targetFolder).toBeVisible()

    await test.step('Move folder and ensure it lands where it, with contents intact', async () => {
      await folderToMove.dragTo(targetFolder)

      await toolbar.ensureFolderOpen(targetFolder, true)
      await expect(folderToMove).toBeVisible()
      await toolbar.ensureFolderOpen(folderToMove, true)
      await expect(movedFile).toBeVisible()
      await toolbar.openFile('inside.kcl')
      await expect(editor.codeContent).toContainText('circle')
      await toolbar.ensureFolderOpen(targetFolder, false)
      await expect(folderToMove).not.toBeAttached()
    })

    await test.step('Undo and ensure the folder returns and has content', async () => {
      await page.keyboard.down('ControlOrMeta')
      await page.keyboard.press('KeyZ')
      await page.keyboard.up('ControlOrMeta')

      await expect(folderToMove).toBeVisible()
      await toolbar.ensureFolderOpen(folderToMove, true)
      await expect(movedFile).toBeVisible()
    })
  })
})

test.describe(
  'Undo and redo do not keep history when navigating between files',
  { tag: '@desktop' },
  () => {
    test(`open a file, change something, open a different file, hitting undo should do nothing`, async ({
      context,
      page,
    }, testInfo) => {
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
      const otherFile = u.locatorFile('other.kcl')

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
    })

    test(`open a file, change something, undo it, open a different file, hitting redo should do nothing`, async ({
      context,
      page,
    }, testInfo) => {
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
      const otherFile = u.locatorFile('other.kcl')

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
    })
  }
)
