import { join } from 'path'
import { bracket } from '@e2e/playwright/fixtures/bracket'
import { FILE_EXT } from '@src/lib/constants'
import * as fsp from 'fs/promises'

import type { CmdBarSerialised } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { ElectronZoo } from '@e2e/playwright/fixtures/fixtureSetup'
import {
  executorInputPath,
  getUtils,
  runningOnWindows,
  testsInputPath,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Testing loading external models', () => {
  /**
   * Note this test implicitly depends on the KCL sample "parametric-bearing-pillow-block",
   * its title, and its units settings. https://github.com/KittyCAD/kcl-samples/blob/main/parametric-bearing-pillow-block/main.kcl
   */
  // We have no more web tests
  test.skip('Web: should overwrite current code, cannot create new file', async ({
    editor,
    context,
    page,
    homePage,
  }) => {
    const u = await getUtils(page)

    await test.step(`Test setup`, async () => {
      await context.addInitScript((code) => {
        window.localStorage.setItem('persistCode', code)
      }, bracket)
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
    })

    // Locators and constants
    const newSample = {
      file: 'parametric-bearing-pillow-block' + FILE_EXT,
      title: 'Parametric Bearing Pillow Block',
    }
    const commandBarButton = page.getByRole('button', { name: 'Commands' })
    const samplesCommandOption = page.getByRole('option', {
      name: 'Load external model',
    })
    const commandSampleOption = page.getByRole('option', {
      name: newSample.title,
      exact: true,
    })
    const commandMethodArgButton = page.getByRole('button', {
      name: 'Method',
    })
    const commandMethodOption = (name: 'Overwrite' | 'Create new file') =>
      page.getByRole('option', {
        name,
      })
    const warningText = page.getByText('Overwrite current file with sample?')
    const confirmButton = page.getByRole('button', { name: 'Submit command' })

    await test.step(`Precondition: check the initial code`, async () => {
      await u.openKclCodePanel()
      await editor.scrollToText(bracket.split('\n')[0])
      await editor.expectEditor.toContain(bracket.split('\n')[0])
    })

    await test.step(`Load a KCL sample with the command palette`, async () => {
      await commandBarButton.click()
      await samplesCommandOption.click()
      await commandSampleOption.click()
      await commandMethodArgButton.click()
      await expect(commandMethodOption('Create new file')).not.toBeVisible()
      await commandMethodOption('Overwrite').click()
      await expect(warningText).toBeVisible()
      await confirmButton.click()

      await editor.expectEditor.toContain('// ' + newSample.title)
    })
  })

  /**
   * Note this test implicitly depends on the KCL samples:
   * "parametric-bearing-pillow-block": https://github.com/KittyCAD/kcl-samples/blob/main/parametric-bearing-pillow-block/main.kcl
   * "gear-rack": https://github.com/KittyCAD/kcl-samples/blob/main/gear-rack/main.kcl
   */
  test(
    'Desktop: should create new file by default, optionally overwrite',
    { tag: '@electron' },
    async ({ editor, context, page, scene, cmdBar, toolbar }) => {
      if (runningOnWindows()) {
      }
      const { dir } = await context.folderSetupFn(async (dir) => {
        const bracketDir = join(dir, 'bracket')
        await fsp.mkdir(bracketDir, { recursive: true })
        await fsp.writeFile(join(bracketDir, 'main.kcl'), bracket, {
          encoding: 'utf-8',
        })
      })
      const u = await getUtils(page)

      // Locators and constants
      const sampleOne = {
        file: 'parametric-bearing-pillow-block' + FILE_EXT,
        title: 'Parametric Bearing Pillow Block',
      }
      const sampleTwo = {
        file: 'gear-rack' + FILE_EXT,
        title: '100mm Gear Rack',
      }
      const projectCard = page.getByRole('link', { name: 'bracket' })
      const commandMethodArgButton = page.getByRole('button', {
        name: 'Method',
      })
      const commandMethodOption = page.getByRole('option', {
        name: 'Overwrite',
      })
      const overwriteWarning = page.getByText(
        'Overwrite current file with sample?'
      )
      const confirmButton = page.getByRole('button', { name: 'Submit command' })
      const projectMenuButton = page.getByTestId('project-sidebar-toggle')
      const newlyCreatedFile = (name: string) =>
        page.getByRole('listitem').filter({
          has: page.getByRole('button', { name }),
        })
      const defaultLoadCmdBarState: CmdBarSerialised = {
        commandName: 'Load external model',
        currentArgKey: 'source',
        currentArgValue: '',
        headerArguments: {
          Method: 'newFile',
          Sample: '',
          Source: '',
        },
        highlightedHeaderArg: 'source',
        stage: 'arguments',
      }

      await test.step(`Test setup`, async () => {
        await page.setBodyDimensions({ width: 1200, height: 500 })
        await projectCard.click()
        await scene.settled(cmdBar)
      })

      await test.step(`Precondition: check the initial code`, async () => {
        await u.openKclCodePanel()
        await editor.scrollToText(bracket.split('\n')[0])
        await editor.expectEditor.toContain(bracket.split('\n')[0])
        await u.openFilePanel()

        await expect(projectMenuButton).toContainText('main.kcl')
        await expect(newlyCreatedFile(sampleOne.file)).not.toBeVisible()
      })

      await test.step(`Load a KCL sample with the command palette`, async () => {
        await toolbar.loadButton.click()
        await cmdBar.expectState(defaultLoadCmdBarState)
        await cmdBar.progressCmdBar()
        await cmdBar.selectOption({ name: sampleOne.title }).click()
        await expect(overwriteWarning).not.toBeVisible()
        await cmdBar.progressCmdBar()
        await page.waitForTimeout(1000)
      })

      await test.step(`Ensure we made and opened a new file`, async () => {
        await editor.expectEditor.toContain('// ' + sampleOne.title)
        await expect(newlyCreatedFile(sampleOne.file)).toBeVisible()
        await expect(projectMenuButton).toContainText(sampleOne.file)
      })

      await test.step(`Now overwrite the current file`, async () => {
        await toolbar.loadButton.click()
        await cmdBar.expectState(defaultLoadCmdBarState)
        await cmdBar.progressCmdBar()
        await cmdBar.selectOption({ name: sampleTwo.title }).click()
        await commandMethodArgButton.click()
        await commandMethodOption.click()
        await expect(commandMethodArgButton).toContainText('overwrite')
        await expect(overwriteWarning).toBeVisible()
        await confirmButton.click()
      })

      await test.step(`Ensure we overwrote the current file without navigating`, async () => {
        await editor.expectEditor.toContain('// ' + sampleTwo.title)
        await test.step(`Check actual file contents`, async () => {
          await expect
            .poll(async () => {
              return await fsp.readFile(
                join(dir, 'bracket', sampleOne.file),
                'utf-8'
              )
            })
            .toContain('// ' + sampleTwo.title)
        })
        await expect(newlyCreatedFile(sampleOne.file)).toBeVisible()
        await expect(newlyCreatedFile(sampleTwo.file)).not.toBeVisible()
        await expect(projectMenuButton).toContainText(sampleOne.file)
      })
    }
  )

  const externalModelCases = [
    {
      modelName: 'cylinder.kcl',
      deconflictedModelName: 'cylinder-1.kcl',
      modelPath: executorInputPath('cylinder.kcl'),
    },
    {
      modelName: 'cube.step',
      deconflictedModelName: 'cube-1.step',
      modelPath: testsInputPath('cube.step'),
    },
  ]
  externalModelCases.map(({ modelName, deconflictedModelName, modelPath }) => {
    test(
      `Load external models from local drive - ${modelName}`,
      { tag: ['@electron'] },
      async ({ page, homePage, scene, toolbar, cmdBar, tronApp }) => {
        if (!tronApp) {
          fail()
        }

        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.goToModelingScene()
        await scene.settled(cmdBar)
        const modelFileContent = await fsp.readFile(modelPath, 'utf-8')
        const { editorTextMatches } = await getUtils(page, test)

        async function loadExternalFileThroughCommandBar(tronApp: ElectronZoo) {
          await toolbar.loadButton.click()
          await cmdBar.expectState({
            commandName: 'Load external model',
            currentArgKey: 'source',
            currentArgValue: '',
            headerArguments: {
              Method: 'newFile',
              Sample: '',
              Source: '',
            },
            highlightedHeaderArg: 'source',
            stage: 'arguments',
          })
          await cmdBar.selectOption({ name: 'Local Drive' }).click()

          // Mock the file picker selection
          const handleFile = tronApp.electron.evaluate(
            async ({ dialog }, filePaths) => {
              dialog.showOpenDialog = () =>
                Promise.resolve({ canceled: false, filePaths })
            },
            [modelPath]
          )
          await page.getByTestId('cmd-bar-arg-file-button').click()
          await handleFile

          await cmdBar.progressCmdBar()
          await cmdBar.expectState({
            commandName: 'Load external model',
            headerArguments: {
              Source: 'local',
              Path: modelName,
            },
            stage: 'review',
          })
          await cmdBar.progressCmdBar()
        }

        await test.step('Load the external model from local drive', async () => {
          await loadExternalFileThroughCommandBar(tronApp)
          // TODO: I think the files pane should auto open?
          await toolbar.openPane('files')
          await toolbar.expectFileTreeState([modelName, 'main.kcl'])
          if (modelName.endsWith('.kcl')) {
            await editorTextMatches(modelFileContent)
          }
        })

        await test.step('Load the same external model, except deconflicted name', async () => {
          await loadExternalFileThroughCommandBar(tronApp)
          await toolbar.openPane('files')
          await toolbar.expectFileTreeState([
            deconflictedModelName,
            modelName,
            'main.kcl',
          ])
          if (modelName.endsWith('.kcl')) {
            await editorTextMatches(modelFileContent)
          }
        })
      }
    )
  })
})
