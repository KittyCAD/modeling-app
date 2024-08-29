import { test, expect } from '@playwright/test'
import * as fsp from 'fs/promises'
import * as fs from 'fs'
import {
  executorInputPath,
  getUtils,
  setup,
  setupElectron,
  tearDown,
} from './test-utils'
import { join } from 'path'
import { FILE_EXT } from 'lib/constants'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('when using the file tree to', () => {
  const fromFile = 'main.kcl'
  const toFile = 'hello.kcl'

  test(
    `rename ${fromFile} to ${toFile}, and doesn't crash on reload and settings load`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async () => {},
      })

      const {
        panesOpen,
        createAndSelectProject,
        pasteCodeInEditor,
        renameFile,
        editorTextMatches,
      } = await getUtils(page, test)

      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files', 'code'])

      await createAndSelectProject('project-000')

      // File the main.kcl with contents
      const kclCube = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

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

      await electronApp.close()
    }
  )

  test(
    `create many new untitled files they increment their names`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async () => {},
      })

      const { panesOpen, createAndSelectProject, createNewFile } =
        await getUtils(page, test)

      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files'])

      await createAndSelectProject('project-000')

      await createNewFile('')
      await createNewFile('')
      await createNewFile('')
      await createNewFile('')
      await createNewFile('')

      await test.step('Postcondition: there are 5 new Untitled-*.kcl files', async () => {
        await expect(
          page
            .locator('[data-testid="file-pane-scroll-container"] button')
            .filter({ hasText: /Untitled[-]?[0-5]?/ })
        ).toHaveCount(5)
      })

      await electronApp.close()
    }
  )

  test(
    'create a new file with the same name as an existing file cancels the operation',
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async () => {},
      })

      const {
        panesOpen,
        createAndSelectProject,
        pasteCodeInEditor,
        createNewFileAndSelect,
        renameFile,
        selectFile,
        editorTextMatches,
      } = await getUtils(page, test)

      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files', 'code'])

      await createAndSelectProject('project-000')
      // File the main.kcl with contents
      const kclCube = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

      const kcl1 = 'main.kcl'
      const kcl2 = '2.kcl'

      await createNewFileAndSelect(kcl2)
      const kclCylinder = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cylinder.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCylinder)

      await renameFile(kcl2, kcl1)

      await test.step(`Postcondition: ${kcl1} still has the original content`, async () => {
        await selectFile(kcl1)
        await editorTextMatches(kclCube)
      })

      await test.step(`Postcondition: ${kcl2} still exists with the original content`, async () => {
        await selectFile(kcl2)
        await editorTextMatches(kclCylinder)
      })

      await electronApp.close()
    }
  )

  test(
    'deleting all files recreates a default main.kcl with no code',
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async () => {},
      })

      const {
        panesOpen,
        createAndSelectProject,
        pasteCodeInEditor,
        deleteFile,
        editorTextMatches,
      } = await getUtils(page, test)

      await page.setViewportSize({ width: 1200, height: 500 })
      page.on('console', console.log)

      await panesOpen(['files', 'code'])

      await createAndSelectProject('project-000')
      // File the main.kcl with contents
      const kclCube = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

      const kcl1 = 'main.kcl'

      await deleteFile(kcl1)

      await test.step(`Postcondition: ${kcl1} is recreated but has no content`, async () => {
        await editorTextMatches('')
      })

      await electronApp.close()
    }
  )
})

test.describe('Renaming in the file tree', () => {
  test(
    'A file you have open',
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page, dir } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
          await fsp.copyFile(
            executorInputPath('basic_fillet_cube_end.kcl'),
            join(dir, 'Test Project', 'main.kcl')
          )
          await fsp.copyFile(
            executorInputPath('cylinder.kcl'),
            join(dir, 'Test Project', 'fileToRename.kcl')
          )
        },
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

      await electronApp.close()
    }
  )

  test(
    'A file you do not have open',
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page, dir } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
          await fsp.mkdir(join(dir, 'Test Project'), { recursive: true })
          await fsp.copyFile(
            executorInputPath('basic_fillet_cube_end.kcl'),
            join(dir, 'Test Project', 'main.kcl')
          )
          await fsp.copyFile(
            executorInputPath('cylinder.kcl'),
            join(dir, 'Test Project', 'fileToRename.kcl')
          )
        },
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

      await electronApp.close()
    }
  )

  test(
    `A folder you're not inside`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page, dir } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
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
        },
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

      await electronApp.close()
    }
  )

  test(
    `A folder you are inside`,
    { tag: '@electron' },
    async ({ browser: _ }, testInfo) => {
      const { electronApp, page, dir } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
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
        },
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
        await page.waitForTimeout(60000)
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

      await electronApp.close()
    }
  )
})

test.describe('Deleting items from the file pane', () => {
  test(
    `delete file when main.kcl exists, navigate to main.kcl`,
    { tag: '@electron' },
    async ({ browserName }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
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
        },
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

      await electronApp.close()
    }
  )

  test.fixme(
    'TODO - delete file we have open when main.kcl does not exist',
    async () => {}
  )

  test(
    `Delete folder we are not in, don't navigate`,
    { tag: '@electron' },
    async ({ browserName }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
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
        },
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

      await electronApp.close()
    }
  )

  test(
    `Delete folder we are in, navigate to main.kcl`,
    { tag: '@electron' },
    async ({ browserName }, testInfo) => {
      const { electronApp, page } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
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
        },
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

      await electronApp.close()
    }
  )

  test.fixme('TODO - delete folder we are in, with no main.kcl', async () => {})
})
