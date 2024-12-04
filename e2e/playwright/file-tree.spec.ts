import { _test, _expect } from './playwright-deprecated'
import { test, expect } from './fixtures/fixtureSetup'
import * as fsp from 'fs/promises'
import * as fs from 'fs'
import {
  createProject,
  executorInputPath,
  getUtils,
  setup,
  setupElectron,
  tearDown,
} from './test-utils'
import { join } from 'path'
import { FILE_EXT } from 'lib/constants'

_test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

_test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('integrations tests', () => {
  test(
    'Creating a new file or switching file while in sketchMode should exit sketchMode',
    { tag: '@electron' },
    async ({ tronApp, homePage, scene, editor, toolbar }) => {
      await tronApp.initialise({
        fixtures: { homePage, scene, editor, toolbar },
        folderSetupFn: async (dir) => {
          const bracketDir = join(dir, 'test-sample')
          await fsp.mkdir(bracketDir, { recursive: true })
          await fsp.copyFile(
            executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
            join(bracketDir, 'main.kcl')
          )
        },
      })
      const [clickObj] = await scene.makeMouseHelpers(600, 300)

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
        await scene.waitForExecutionDone()
      })
      await test.step('enter sketch mode', async () => {
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

  test.fixme(
    `rename ${fromFile} to ${toFile}, and doesn't crash on reload and settings load`,
    { tag: '@electron' },
    async ({ browser: _, tronApp }, testInfo) => {
      await tronApp.initialise()

      const { panesOpen, pasteCodeInEditor, renameFile, editorTextMatches } =
        await getUtils(tronApp.page, test)

      await tronApp.page.setViewportSize({ width: 1200, height: 500 })
      tronApp.page.on('console', console.log)

      await panesOpen(['files', 'code'])

      await createProject({ name: 'project-000', page: tronApp.page })

      // File the main.kcl with contents
      const kclCube = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

      // TODO: We have a timeout of 1s between edits to write to disk. If you reload the page too quickly it won't write to disk.
      await tronApp.page.waitForTimeout(2000)

      await renameFile(fromFile, toFile)
      await tronApp.page.reload()

      await test.step('Postcondition: editor has same content as before the rename', async () => {
        await editorTextMatches(kclCube)
      })

      await test.step('Postcondition: opening and closing settings works', async () => {
        const settingsOpenButton = tronApp.page.getByRole('link', {
          name: 'settings Settings',
        })
        const settingsCloseButton = tronApp.page.getByTestId(
          'settings-close-button'
        )
        await settingsOpenButton.click()
        await settingsCloseButton.click()
      })

      await tronApp.close()
    }
  )

  test.fixme(
    `create many new untitled files they increment their names`,
    { tag: '@electron' },
    async ({ browser: _, tronApp }, testInfo) => {
      await tronApp.initialise()

      const { panesOpen, createNewFile } = await getUtils(tronApp.page, test)

      await tronApp.page.setViewportSize({ width: 1200, height: 500 })
      tronApp.page.on('console', console.log)

      await panesOpen(['files'])

      await createProject({ name: 'project-000', page: tronApp.page })

      await createNewFile('')
      await createNewFile('')
      await createNewFile('')
      await createNewFile('')
      await createNewFile('')

      await test.step('Postcondition: there are 5 new Untitled-*.kcl files', async () => {
        await expect(
          tronApp.page
            .locator('[data-testid="file-pane-scroll-container"] button')
            .filter({ hasText: /Untitled[-]?[0-5]?/ })
        ).toHaveCount(5)
      })

      await tronApp.close()
    }
  )

  test(
    'create a new file with the same name as an existing file cancels the operation',
    { tag: '@electron' },
    async (
      { browser: _, tronApp, homePage, scene, editor, toolbar },
      testInfo
    ) => {
      const projectName = 'cube'
      const mainFile = 'main.kcl'
      const secondFile = 'cylinder.kcl'
      const kclCube = await fsp.readFile(executorInputPath('cube.kcl'), 'utf-8')
      const kclCylinder = await fsp.readFile(
        executorInputPath('cylinder.kcl'),
        'utf-8'
      )
      await tronApp.initialise({
        fixtures: { homePage, scene, editor, toolbar },
        folderSetupFn: async (dir) => {
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
        },
      })

      const {
        openFilePanel,
        renameFile,
        selectFile,
        editorTextMatches,
        waitForPageLoad,
      } = await getUtils(tronApp.page, _test)

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

      await tronApp.close()
    }
  )

  test(
    'deleting all files recreates a default main.kcl with no code',
    { tag: '@electron' },
    async ({ browser: _, tronApp }, testInfo) => {
      await tronApp.initialise()

      const { panesOpen, pasteCodeInEditor, deleteFile, editorTextMatches } =
        await getUtils(tronApp.page, _test)

      await tronApp.page.setViewportSize({ width: 1200, height: 500 })
      tronApp.page.on('console', console.log)

      await panesOpen(['files', 'code'])

      await createProject({ name: 'project-000', page: tronApp.page })
      // File the main.kcl with contents
      const kclCube = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cube.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclCube)

      const mainFile = 'main.kcl'

      await deleteFile(mainFile)

      await test.step(`Postcondition: ${mainFile} is recreated but has no content`, async () => {
        await editorTextMatches('')
      })

      await tronApp.close()
    }
  )

  test.fixme(
    'loading small file, then large, then back to small',
    {
      tag: '@electron',
    },
    async ({ browser: _, tronApp }, testInfo) => {
      await tronApp.initialise()

      const {
        panesOpen,
        pasteCodeInEditor,
        createNewFile,
        openDebugPanel,
        closeDebugPanel,
        expectCmdLog,
      } = await getUtils(tronApp.page, test)

      await tronApp.page.setViewportSize({ width: 1200, height: 500 })
      tronApp.page.on('console', console.log)

      await panesOpen(['files', 'code'])
      await createProject({ name: 'project-000', page: tronApp.page })

      // Create a small file
      const kclCube = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/cube.kcl',
        'utf-8'
      )
      // pasted into main.kcl
      await pasteCodeInEditor(kclCube)

      // Create a large lego file
      await createNewFile('lego')
      const legoFile = tronApp.page.getByRole('listitem').filter({
        has: tronApp.page.getByRole('button', { name: 'lego.kcl' }),
      })
      await _expect(legoFile).toBeVisible({ timeout: 60_000 })
      await legoFile.click()
      const kclLego = await fsp.readFile(
        'src/wasm-lib/tests/executor/inputs/lego.kcl',
        'utf-8'
      )
      await pasteCodeInEditor(kclLego)
      const mainFile = tronApp.page.getByRole('listitem').filter({
        has: tronApp.page.getByRole('button', { name: 'main.kcl' }),
      })

      // Open settings and enable the debug panel
      await tronApp.page
        .getByRole('link', {
          name: 'settings Settings',
        })
        .click()
      await tronApp.page.locator('#showDebugPanel').getByText('OffOn').click()
      await tronApp.page.getByTestId('settings-close-button').click()

      await _test.step('swap between small and large files', async () => {
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

      await tronApp.close()
    }
  )
})

_test.describe('Renaming in the file tree', () => {
  _test(
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

      await _test.step('Open project and file pane', async () => {
        await _expect(projectLink).toBeVisible()
        await projectLink.click()
        await _expect(projectMenuButton).toBeVisible()
        await _expect(projectMenuButton).toContainText('main.kcl')

        await u.openFilePanel()
        await _expect(fileToRename).toBeVisible()
        _expect(checkUnRenamedFS()).toBeTruthy()
        _expect(checkRenamedFS()).toBeFalsy()
        await fileToRename.click()
        await _expect(projectMenuButton).toContainText('fileToRename.kcl')
        await u.openKclCodePanel()
        await _expect(codeLocator).toContainText('circle(')
        await u.closeKclCodePanel()
      })

      await _test.step('Rename the file', async () => {
        await fileToRename.click({ button: 'right' })
        await renameMenuItem.click()
        await _expect(renameInput).toBeVisible()
        await renameInput.fill(newFileName)
        await page.keyboard.press('Enter')
      })

      await _test.step('Verify the file is renamed', async () => {
        await _expect(fileToRename).not.toBeAttached()
        await _expect(renamedFile).toBeVisible()
        _expect(checkUnRenamedFS()).toBeFalsy()
        _expect(checkRenamedFS()).toBeTruthy()
      })

      await _test.step('Verify we navigated', async () => {
        await _expect(projectMenuButton).toContainText(newFileName + FILE_EXT)
        const url = page.url()
        _expect(url).toContain(newFileName)
        await _expect(projectMenuButton).not.toContainText('fileToRename.kcl')
        await _expect(projectMenuButton).not.toContainText('main.kcl')
        _expect(url).not.toContain('fileToRename.kcl')
        _expect(url).not.toContain('main.kcl')

        await u.openKclCodePanel()
        await _expect(codeLocator).toContainText('circle(')
      })

      await electronApp.close()
    }
  )

  _test(
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

      await _test.step('Open project and file pane', async () => {
        await _expect(projectLink).toBeVisible()
        await projectLink.click()
        await _expect(projectMenuButton).toBeVisible()
        await _expect(projectMenuButton).toContainText('main.kcl')

        await u.openFilePanel()
        await _expect(fileToRename).toBeVisible()
        _expect(checkUnRenamedFS()).toBeTruthy()
        _expect(checkRenamedFS()).toBeFalsy()
      })

      await _test.step('Rename the file', async () => {
        await fileToRename.click({ button: 'right' })
        await renameMenuItem.click()
        await _expect(renameInput).toBeVisible()
        await renameInput.fill(newFileName)
        await page.keyboard.press('Enter')
      })

      await _test.step('Verify the file is renamed', async () => {
        await _expect(fileToRename).not.toBeAttached()
        await _expect(renamedFile).toBeVisible()
        _expect(checkUnRenamedFS()).toBeFalsy()
        _expect(checkRenamedFS()).toBeTruthy()
      })

      await _test.step('Verify we have not navigated', async () => {
        await _expect(projectMenuButton).toContainText('main.kcl')
        await _expect(projectMenuButton).not.toContainText(
          newFileName + FILE_EXT
        )
        await _expect(projectMenuButton).not.toContainText('fileToRename.kcl')

        const url = page.url()
        _expect(url).toContain('main.kcl')
        _expect(url).not.toContain(newFileName)
        _expect(url).not.toContain('fileToRename.kcl')

        await u.openKclCodePanel()
        await _expect(codeLocator).toContainText('fillet(')
      })

      await electronApp.close()
    }
  )

  _test(
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

      await _test.step('Open project and file pane', async () => {
        await _expect(projectLink).toBeVisible()
        await projectLink.click()
        await _expect(projectMenuButton).toBeVisible()
        await _expect(projectMenuButton).toContainText('main.kcl')

        const url = page.url()
        _expect(url).toContain('main.kcl')
        _expect(url).not.toContain('folderToRename')

        await u.openFilePanel()
        await _expect(folderToRename).toBeVisible()
        _expect(checkUnRenamedFolderFS()).toBeTruthy()
        _expect(checkRenamedFolderFS()).toBeFalsy()
      })

      await _test.step('Rename the folder', async () => {
        await folderToRename.click({ button: 'right' })
        await _expect(renameMenuItem).toBeVisible()
        await renameMenuItem.click()
        await _expect(renameInput).toBeVisible()
        await renameInput.fill(newFolderName)
        await page.keyboard.press('Enter')
      })

      await _test.step(
        'Verify the folder is renamed, and no navigation occurred',
        async () => {
          const url = page.url()
          _expect(url).toContain('main.kcl')
          _expect(url).not.toContain('folderToRename')

          await _expect(projectMenuButton).toContainText('main.kcl')
          await _expect(renamedFolder).toBeVisible()
          await _expect(folderToRename).not.toBeAttached()
          _expect(checkUnRenamedFolderFS()).toBeFalsy()
          _expect(checkRenamedFolderFS()).toBeTruthy()
        }
      )

      await electronApp.close()
    }
  )

  _test(
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

      await _test.step('Open project and navigate into folder', async () => {
        await _expect(projectLink).toBeVisible()
        await projectLink.click()
        await _expect(projectMenuButton).toBeVisible()
        await _expect(projectMenuButton).toContainText('main.kcl')

        const url = page.url()
        _expect(url).toContain('main.kcl')
        _expect(url).not.toContain('folderToRename')

        await u.openFilePanel()
        await _expect(folderToRename).toBeVisible()
        await folderToRename.click()
        await _expect(fileWithinFolder).toBeVisible()
        await fileWithinFolder.click()

        await _expect(projectMenuButton).toContainText('someFileWithin.kcl')
        const newUrl = page.url()
        _expect(newUrl).toContain('folderToRename')
        _expect(newUrl).toContain('someFileWithin.kcl')
        _expect(newUrl).not.toContain('main.kcl')
        _expect(checkUnRenamedFolderFS()).toBeTruthy()
        _expect(checkRenamedFolderFS()).toBeFalsy()
      })

      await _test.step('Rename the folder', async () => {
        await page.waitForTimeout(1000)
        await folderToRename.click({ button: 'right' })
        await _expect(renameMenuItem).toBeVisible()
        await renameMenuItem.click()
        await _expect(renameInput).toBeVisible()
        await renameInput.fill(newFolderName)
        await page.keyboard.press('Enter')
      })

      await _test.step(
        'Verify the folder is renamed, and navigated to new path',
        async () => {
          const urlSnippet = encodeURIComponent(
            join(newFolderName, 'someFileWithin.kcl')
          )
          await page.waitForURL(new RegExp(urlSnippet))
          await _expect(projectMenuButton).toContainText('someFileWithin.kcl')
          await _expect(renamedFolder).toBeVisible()
          await _expect(folderToRename).not.toBeAttached()

          // URL is synchronous, so we check the other stuff first
          const url = page.url()
          _expect(url).not.toContain('main.kcl')
          _expect(url).toContain(newFolderName)
          _expect(url).toContain('someFileWithin.kcl')
          _expect(checkUnRenamedFolderFS()).toBeFalsy()
          _expect(checkRenamedFolderFS()).toBeTruthy()
        }
      )

      await electronApp.close()
    }
  )
})

_test.describe('Deleting items from the file pane', () => {
  _test(
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

      await _test.step(
        'Open project and navigate to fileToDelete.kcl',
        async () => {
          await projectCard.click()
          await u.waitForPageLoad()
          await u.openFilePanel()

          await fileToDelete.click()
          await u.waitForPageLoad()
          await u.openKclCodePanel()
          await _expect(u.codeLocator).toContainText('getOppositeEdge(thing)')
          await u.closeKclCodePanel()
        }
      )

      await _test.step('Delete fileToDelete.kcl', async () => {
        await fileToDelete.click({ button: 'right' })
        await _expect(deleteMenuItem).toBeVisible()
        await deleteMenuItem.click()
        await _expect(deleteConfirmation).toBeVisible()
        await deleteConfirmation.click()
      })

      await _test.step('Check deletion and navigation', async () => {
        await u.waitForPageLoad()
        await _expect(fileToDelete).not.toBeVisible()
        await u.closeFilePanel()
        await u.openKclCodePanel()
        await _expect(u.codeLocator).toContainText('circle(')
        await _expect(projectMenuButton).toContainText('main.kcl')
      })

      await electronApp.close()
    }
  )

  _test.fixme(
    'TODO - delete file we have open when main.kcl does not exist',
    async () => {}
  )

  _test(
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

      await _test.step('Open project and open project pane', async () => {
        await projectCard.click()
        await u.waitForPageLoad()
        await _expect(projectMenuButton).toContainText('main.kcl')
        await u.closeKclCodePanel()
        await u.openFilePanel()
      })

      await _test.step('Delete folderToDelete', async () => {
        await folderToDelete.click({ button: 'right' })
        await _expect(deleteMenuItem).toBeVisible()
        await deleteMenuItem.click()
        await _expect(deleteConfirmation).toBeVisible()
        await deleteConfirmation.click()
      })

      await _test.step('Check deletion and no navigation', async () => {
        await _expect(folderToDelete).not.toBeAttached()
        await _expect(projectMenuButton).toContainText('main.kcl')
      })

      await electronApp.close()
    }
  )

  _test(
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

      await _test.step(
        'Open project and navigate into folderToDelete',
        async () => {
          await projectCard.click()
          await u.waitForPageLoad()
          await _expect(projectMenuButton).toContainText('main.kcl')
          await u.closeKclCodePanel()
          await u.openFilePanel()

          await folderToDelete.click()
          await _expect(fileWithinFolder).toBeVisible()
          await fileWithinFolder.click()
          await _expect(projectMenuButton).toContainText('someFileWithin.kcl')
        }
      )

      await _test.step('Delete folderToDelete', async () => {
        await folderToDelete.click({ button: 'right' })
        await _expect(deleteMenuItem).toBeVisible()
        await deleteMenuItem.click()
        await _expect(deleteConfirmation).toBeVisible()
        await deleteConfirmation.click()
      })

      await _test.step(
        'Check deletion and navigation to main.kcl',
        async () => {
          await _expect(folderToDelete).not.toBeAttached()
          await _expect(fileWithinFolder).not.toBeAttached()
          await _expect(projectMenuButton).toContainText('main.kcl')
        }
      )

      await electronApp.close()
    }
  )

  _test.fixme(
    'TODO - delete folder we are in, with no main.kcl',
    async () => {}
  )

  // Copied from tests above.
  _test(
    `external deletion of project navigates back home`,
    { tag: '@electron' },
    async ({ browserName }, testInfo) => {
      const TEST_PROJECT_NAME = 'Test Project'
      const {
        electronApp,
        page,
        dir: projectsDirName,
      } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
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
        },
      })
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

      await _test.step(
        'Open project and navigate into folderToDelete',
        async () => {
          await projectCard.click()
          await u.waitForPageLoad()
          await _expect(projectMenuButton).toContainText('main.kcl')
          await u.closeKclCodePanel()
          await u.openFilePanel()

          await folderToDelete.click()
          await _expect(fileWithinFolder).toBeVisible()
          await fileWithinFolder.click()
          await _expect(projectMenuButton).toContainText('someFileWithin.kcl')
        }
      )

      // Point of divergence. Delete the project folder and see if it goes back
      // to the home view.
      await _test.step(
        'Delete projectsDirName/<project-name> externally',
        async () => {
          await fsp.rm(join(projectsDirName, TEST_PROJECT_NAME), {
            recursive: true,
            force: true,
          })
        }
      )

      await _test.step('Check the app is back on the home view', async () => {
        const projectsDirLink = page.getByText('Loaded from')
        await _expect(projectsDirLink).toBeVisible()
      })

      await electronApp.close()
    }
  )

  // Similar to the above
  _test(
    `external deletion of file in sub-directory updates the file tree and recreates it on code editor typing`,
    { tag: '@electron' },
    async ({ browserName }, testInfo) => {
      const TEST_PROJECT_NAME = 'Test Project'
      const {
        electronApp,
        page,
        dir: projectsDirName,
      } = await setupElectron({
        testInfo,
        folderSetupFn: async (dir) => {
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
        },
      })
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

      await _test.step(
        'Open project and navigate into folderToDelete',
        async () => {
          await projectCard.click()
          await u.waitForPageLoad()
          await _expect(projectMenuButton).toContainText('main.kcl')

          await u.openFilePanel()

          await folderToDelete.click()
          await _expect(fileWithinFolder).toBeVisible()
          await fileWithinFolder.click()
          await _expect(projectMenuButton).toContainText('someFileWithin.kcl')
        }
      )

      await _test.step(
        'Delete projectsDirName/<project-name> externally',
        async () => {
          await fsp.rm(
            join(
              projectsDirName,
              TEST_PROJECT_NAME,
              'folderToDelete',
              'someFileWithin.kcl'
            )
          )
        }
      )

      await _test.step('Check the file is gone in the file tree', async () => {
        await _expect(
          page.getByTestId('file-pane-scroll-container')
        ).not.toContainText('someFileWithin.kcl')
      })

      await _test.step(
        'Check the file is back in the file tree after typing in code editor',
        async () => {
          await u.pasteCodeInEditor('hello = 1')
          await _expect(
            page.getByTestId('file-pane-scroll-container')
          ).toContainText('someFileWithin.kcl')
        }
      )

      await electronApp.close()
    }
  )
})

_test.describe(
  'Undo and redo do not keep history when navigating between files',
  () => {
    _test(
      `open a file, change something, open a different file, hitting undo should do nothing`,
      { tag: '@electron' },
      async ({ browserName }, testInfo) => {
        const { page } = await setupElectron({
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
              join(testDir, 'other.kcl')
            )
          },
        })
        const u = await getUtils(page)
        await page.setViewportSize({ width: 1200, height: 500 })
        page.on('console', console.log)

        // Constants and locators
        const projectCard = page.getByText('testProject')
        const otherFile = page
          .getByRole('listitem')
          .filter({ has: page.getByRole('button', { name: 'other.kcl' }) })

        await _test.step(
          'Open project and make a change to the file',
          async () => {
            await projectCard.click()
            await u.waitForPageLoad()

            // Get the text in the code locator.
            const originalText = await u.codeLocator.innerText()
            // Click in the editor and add some new lines.
            await u.codeLocator.click()

            await page.keyboard.type(`sketch001 = startSketchOn('XY')
    some other shit`)

            // Ensure the content in the editor changed.
            const newContent = await u.codeLocator.innerText()

            expect(originalText !== newContent)
          }
        )

        await _test.step('navigate to other.kcl', async () => {
          await u.openFilePanel()

          await otherFile.click()
          await u.waitForPageLoad()
          await u.openKclCodePanel()
          await _expect(u.codeLocator).toContainText('getOppositeEdge(thing)')
        })

        await _test.step('hit undo', async () => {
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

    _test(
      `open a file, change something, undo it, open a different file, hitting redo should do nothing`,
      { tag: '@electron' },
      // Skip on windows i think the keybindings are different for redo.
      async ({ browserName }, testInfo) => {
        test.skip(process.platform === 'win32', 'Skip on windows')
        const { page } = await setupElectron({
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
              join(testDir, 'other.kcl')
            )
          },
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
        await _test.step(
          'Open project and make a change to the file',
          async () => {
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
          }
        )

        await _test.step('navigate to other.kcl', async () => {
          await u.openFilePanel()

          await otherFile.click()
          await u.waitForPageLoad()
          await u.openKclCodePanel()
          await _expect(u.codeLocator).toContainText('getOppositeEdge(thing)')
          await expect(u.codeLocator).not.toContainText(badContent)
        })

        await _test.step('hit redo', async () => {
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
  }
)
