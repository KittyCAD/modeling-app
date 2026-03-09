import path from 'path'
import * as fsp from 'fs/promises'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import {
  doAndWaitForImageDiff,
  executorInputPath,
  kclSamplesPath,
  testsInputPath,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { BrowserContext, Page } from '@playwright/test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'

async function insertPartIntoAssembly(
  path: string,
  alias: string,
  toolbar: ToolbarFixture,
  cmdBar: CmdBarFixture,
  page: Page
) {
  await toolbar.insertButton.click()
  await cmdBar.selectOption({ name: path }).click()
  await cmdBar.expectState({
    stage: 'arguments',
    currentArgKey: 'localName',
    currentArgValue: '',
    headerArguments: { Path: path, LocalName: '' },
    highlightedHeaderArg: 'localName',
    commandName: 'Insert',
  })
  await page.keyboard.insertText(alias)
  await cmdBar.progressCmdBar()
  await cmdBar.expectState({
    stage: 'review',
    headerArguments: { Path: path, LocalName: alias },
    commandName: 'Insert',
  })
  await cmdBar.progressCmdBar()
}

// test file is for testing point an click code gen functionality that's assemblies related
test.describe(
  'Point-and-click assemblies tests',
  { tag: ['@desktop', '@macos', '@windows'] },
  () => {
    test(`Insert kcl parts into assembly as whole module import`, async ({
      folderSetupFn,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
      tronApp,
    }) => {
      if (!tronApp) throw new Error('tronApp is missing.')

      await test.step('Setup parts and expect empty assembly scene', async () => {
        const projectName = 'assembly'
        await folderSetupFn(async (dir) => {
          const projDir = path.join(dir, projectName)
          const nestedProjDir = path.join(dir, projectName, 'nested', 'twice')
          await fsp.mkdir(projDir, { recursive: true })
          await fsp.mkdir(nestedProjDir, { recursive: true })
          await Promise.all([
            fsp.copyFile(
              executorInputPath('cylinder.kcl'),
              path.join(projDir, 'cylinder.kcl')
            ),
            fsp.copyFile(
              executorInputPath('cylinder.kcl'),
              path.join(nestedProjDir, 'main.kcl')
            ),
            fsp.copyFile(
              executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
              path.join(projDir, 'bracket.kcl')
            ),
            fsp.copyFile(
              testsInputPath('cube.step'),
              path.join(projDir, 'cube.step')
            ),
            fsp.writeFile(path.join(projDir, 'main.kcl'), ''),
          ])
        })
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
      })

      await test.step('Insert kcl as first part as module', async () => {
        await insertPartIntoAssembly(
          'cylinder.kcl',
          'cylinder',
          toolbar,
          cmdBar,
          page
        )
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
          import "cylinder.kcl" as cylinder
          `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)
      })

      await test.step('Insert a second part with the same name and expect error', async () => {
        await toolbar.insertButton.click()
        await cmdBar.selectOption({ name: 'bracket.kcl' }).click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'localName',
          currentArgValue: '',
          headerArguments: { Path: 'bracket.kcl', LocalName: '' },
          highlightedHeaderArg: 'localName',
          commandName: 'Insert',
        })
        await page.keyboard.insertText('cylinder')
        await cmdBar.progressCmdBar()
        await expect(
          page.getByText('This variable name is already in use')
        ).toBeVisible()
      })

      await test.step('Fix the name and expect the second part inserted', async () => {
        await cmdBar.argumentInput.clear()
        await page.keyboard.insertText('bracket')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Path: 'bracket.kcl', LocalName: 'bracket' },
          commandName: 'Insert',
        })
        await cmdBar.progressCmdBar()
        await editor.expectEditor.toContain(
          `
            import "cylinder.kcl" as cylinder
            import "bracket.kcl" as bracket
          `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)
      })

      await test.step('Insert a second time and expect error', async () => {
        await toolbar.insertButton.click()
        await cmdBar.selectOption({ name: 'bracket.kcl' }).click()
        await expect(
          page.getByText('This file is already imported')
        ).toBeVisible()
        await cmdBar.closeCmdBar()
      })

      await test.step('Insert a nested kcl part', async () => {
        await insertPartIntoAssembly(
          'nested/twice/main.kcl',
          'main',
          toolbar,
          cmdBar,
          page
        )
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
          import "nested/twice/main.kcl" as main
          `,
          { shouldNormalise: true }
        )
      })
    })

    async function testBracketInsertionThenTransformsThenDeletion(
      context: BrowserContext,
      page: Page,
      homePage: HomePageFixture,
      scene: SceneFixture,
      editor: EditorFixture,
      toolbar: ToolbarFixture,
      cmdBar: CmdBarFixture,
      selectionType: 'scene' | 'feature-tree',
      folderSetupFn: (
        fn: (dir: string) => Promise<void>
      ) => Promise<{ dir: string }>
    ) {
      const selectedObjects = selectionType === 'scene' ? '1 path' : '1 plane'
      async function selectBracket() {
        if (selectionType === 'scene') {
          const [clickBracketInScene] = scene.makeMouseHelpers(0.5, 0.5, {
            format: 'ratio',
          })
          await clickBracketInScene()
          return
        } else if (selectionType === 'feature-tree') {
          const op = await toolbar.getFeatureTreeOperation('bracket', 0)
          await op.click()
        } else {
          const _exhaustiveCheck: never = selectionType
          throw new Error('unreachable')
        }
      }
      await test.step('Setup parts and expect empty assembly scene', async () => {
        const projectName = 'assembly'
        await folderSetupFn(async (dir) => {
          const bracketDir = path.join(dir, projectName)
          await fsp.mkdir(bracketDir, { recursive: true })
          await Promise.all([
            fsp.copyFile(
              path.join('public', 'kcl-samples', 'bracket', 'main.kcl'),
              path.join(bracketDir, 'bracket.kcl')
            ),
            fsp.writeFile(path.join(bracketDir, 'main.kcl'), ''),
          ])
        })
        await page.setBodyDimensions({ width: 1200, height: 800 })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.Code)
      })

      await test.step('Insert kcl as module', async () => {
        await insertPartIntoAssembly(
          'bracket.kcl',
          'bracket',
          toolbar,
          cmdBar,
          page
        )
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
            import "bracket.kcl" as bracket
          `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)
      })

      await test.step('Set translate on module', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.selectTransform('translate')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'objects',
          currentArgValue: '',
          headerArguments: {
            Objects: '',
          },
          highlightedHeaderArg: 'objects',
          commandName: 'Translate',
        })
        await selectBracket()
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: selectedObjects,
          },
          commandName: 'Translate',
          reviewValidationError:
            'semantic: Expected `x`, `y`, or `z` to be provided.',
        })
        await cmdBar.clickOptionalArgument('x')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'x',
          currentArgValue: '0',
          headerArguments: {
            Objects: selectedObjects,
            X: '',
          },
          highlightedHeaderArg: 'x',
          commandName: 'Translate',
        })
        await page.keyboard.insertText('1')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: selectedObjects,
            X: '1',
          },
          commandName: 'Translate',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(`translate(bracket, x = 1)`, {
          shouldNormalise: true,
        })
      })

      await test.step('Edit translate on module', async () => {
        const op = await toolbar.getFeatureTreeOperation('Translate', 0)
        await op.dblclick()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            X: '1',
          },
          commandName: 'Translate',
        })
        await cmdBar.clickOptionalArgument('y')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'y',
          currentArgValue: '0',
          headerArguments: {
            X: '1',
            Y: '',
          },
          highlightedHeaderArg: 'y',
          commandName: 'Translate',
        })
        await page.keyboard.insertText('2')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            X: '1',
            Y: '2',
          },
          commandName: 'Translate',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain(
          `translate(bracket, x = 1, y = 2)`,
          {
            shouldNormalise: true,
          }
        )
      })

      await test.step('Set scale on module', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.selectTransform('scale')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'objects',
          currentArgValue: '',
          headerArguments: {
            Objects: '',
          },
          highlightedHeaderArg: 'objects',
          commandName: 'Scale',
        })
        await selectBracket()
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: selectedObjects,
          },
          commandName: 'Scale',
          reviewValidationError:
            'semantic: Expected `x`, `y`, `z` or `factor` to be provided.',
        })
        await cmdBar.clickOptionalArgument('x')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'x',
          currentArgValue: '1',
          headerArguments: {
            Objects: selectedObjects,
            X: '',
          },
          highlightedHeaderArg: 'x',
          commandName: 'Scale',
        })
        await page.keyboard.insertText('1.1')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: selectedObjects,
            X: '1.1',
          },
          commandName: 'Scale',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `translate(bracket, x = 1, y = 2)
          scale(bracket, x = 1.1)`,
          { shouldNormalise: true }
        )
      })

      await test.step('Edit scale on module', async () => {
        const op = await toolbar.getFeatureTreeOperation('Scale', 0)
        await op.dblclick()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            X: '1.1',
          },
          commandName: 'Scale',
        })
        await cmdBar.clickOptionalArgument('y')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'y',
          currentArgValue: '1',
          headerArguments: {
            X: '1.1',
            Y: '',
          },
          highlightedHeaderArg: 'y',
          commandName: 'Scale',
        })
        await page.keyboard.insertText('1.2')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            X: '1.1',
            Y: '1.2',
          },
          commandName: 'Scale',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain(
          `scale(bracket, x = 1.1, y = 1.2)`,
          {
            shouldNormalise: true,
          }
        )
      })

      await test.step('Set rotate on module', async () => {
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)

        await toolbar.selectTransform('rotate')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'objects',
          currentArgValue: '',
          headerArguments: {
            Objects: '',
          },
          highlightedHeaderArg: 'objects',
          commandName: 'Rotate',
        })
        await selectBracket()
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: selectedObjects,
          },
          commandName: 'Rotate',
          reviewValidationError:
            'semantic: Expected `roll`, `pitch`, and `yaw` or `axis` and `angle` to be provided.',
        })
        await cmdBar.clickOptionalArgument('roll')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'roll',
          currentArgValue: '0',
          headerArguments: {
            Objects: selectedObjects,
            Roll: '',
          },
          highlightedHeaderArg: 'roll',
          commandName: 'Rotate',
        })
        await page.keyboard.insertText('0.1')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: selectedObjects,
            Roll: '0.1',
          },
          commandName: 'Rotate',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
          translate(bracket, x = 1, y = 2)
          scale(bracket, x = 1.1, y = 1.2)
          rotate(bracket, roll = 0.1)
          `,
          { shouldNormalise: true }
        )
      })

      await test.step('Edit rotate on module', async () => {
        const op = await toolbar.getFeatureTreeOperation('Rotate', 0)
        await op.dblclick()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Roll: '0.1',
          },
          commandName: 'Rotate',
        })
        await cmdBar.clickOptionalArgument('yaw')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'yaw',
          currentArgValue: '0',
          headerArguments: {
            Roll: '0.1',
            Yaw: '',
          },
          highlightedHeaderArg: 'yaw',
          commandName: 'Rotate',
        })
        await page.keyboard.insertText('0.2')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Roll: '0.1',
            Yaw: '0.2',
          },
          commandName: 'Rotate',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
        await editor.expectEditor.toContain(
          `rotate(bracket, roll = 0.1, yaw = 0.2)`,
          {
            shouldNormalise: true,
          }
        )
      })

      await test.step('Delete the part using the feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const opr = await toolbar.getFeatureTreeOperation('Rotate', 0)
        await opr.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        const ops = await toolbar.getFeatureTreeOperation('Scale', 0)
        await ops.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        const opt = await toolbar.getFeatureTreeOperation('Translate', 0)
        await opt.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await selectBracket()
        await page.keyboard.press('Delete')
        await scene.settled(cmdBar)
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

        // Expect empty editor and scene
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.not.toContain('translate')
        await editor.expectEditor.not.toContain('scale')
        await editor.expectEditor.not.toContain('rotate')
      })
    }

    test(`Insert the bracket part into an assembly and transform it (feature-tree selection)`, async ({
      context,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
      tronApp,
      folderSetupFn,
    }) => {
      if (!tronApp) throw new Error('tronApp is missing.')
      await testBracketInsertionThenTransformsThenDeletion(
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
        'feature-tree',
        folderSetupFn
      )
    })

    test(`Insert the bracket part into an assembly and transform it (scene selection)`, async ({
      context,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
      tronApp,
      folderSetupFn,
    }) => {
      if (!tronApp) throw new Error('tronApp is missing.')
      await testBracketInsertionThenTransformsThenDeletion(
        context,
        page,
        homePage,
        scene,
        editor,
        toolbar,
        cmdBar,
        'scene',
        folderSetupFn
      )
    })

    test(`Insert foreign parts into assembly and delete them`, async ({
      folderSetupFn,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
      tronApp,
    }) => {
      if (!tronApp) throw new Error('tronApp is missing.')

      const complexPlmFileName = 'cube_Complex-PLM_Name_-001.sldprt'
      const camelCasedSolidworksFileName = 'cubeComplexPLMName001'

      await test.step('Setup parts and expect empty assembly scene', async () => {
        const projectName = 'assembly'
        await folderSetupFn(async (dir) => {
          const bracketDir = path.join(dir, projectName)
          await fsp.mkdir(bracketDir, { recursive: true })
          await Promise.all([
            fsp.copyFile(
              testsInputPath('cube.step'),
              path.join(bracketDir, 'cube.step')
            ),
            fsp.copyFile(
              testsInputPath('cube.sldprt'),
              path.join(bracketDir, complexPlmFileName)
            ),
            fsp.writeFile(path.join(bracketDir, 'main.kcl'), ''),
          ])
        })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
      })

      await test.step('Insert step part as module', async () => {
        await insertPartIntoAssembly('cube.step', 'cube', toolbar, cmdBar, page)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
          import "cube.step" as cube
        `,
          { shouldNormalise: true }
        )
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await scene.settled(cmdBar)

        await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
      })

      await test.step('Insert second foreign part by clicking', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.Files)
        await toolbar.expectFileTreeState([
          complexPlmFileName,
          'cube.step',
          'main.kcl',
        ])
        await toolbar.openFile(complexPlmFileName)

        // Go through the ToastInsert prompt
        await page.getByText('Insert into my current file').click()

        // Check getPathFilenameInVariableCase output
        const parsedValueFromFile =
          await cmdBar.currentArgumentInput.inputValue()
        expect(parsedValueFromFile).toEqual(camelCasedSolidworksFileName)

        // Continue on with the flow
        await page.keyboard.insertText('cubeSw')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Path: complexPlmFileName, LocalName: 'cubeSw' },
          commandName: 'Insert',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane(DefaultLayoutPaneID.Files)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
          import "cube.step" as cube
          import "${complexPlmFileName}" as cubeSw
        `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)

        await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
      })

      await test.step('Delete first part using the feature tree', async () => {
        page.on('console', console.log)
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const op = await toolbar.getFeatureTreeOperation('cube', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

        // Expect only the import statement to be there
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.not.toContain(`import "cube.step" as cube`)
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
          import "${complexPlmFileName}" as cubeSw
        `,
          { shouldNormalise: true }
        )
        await toolbar.closePane(DefaultLayoutPaneID.Code)
      })

      await test.step('Delete second part using the feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const op = await toolbar.getFeatureTreeOperation('cubeSw', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

        // Expect empty editor and scene
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.not.toContain(
          `import "${complexPlmFileName}" as cubeSw`
        )
        await toolbar.closePane(DefaultLayoutPaneID.Code)
      })
    })

    test('Assembly gets reexecuted when imported models are updated externally', async ({
      folderSetupFn,
      page,
      homePage,
      scene,
      toolbar,
      cmdBar,
      tronApp,
    }) => {
      if (!tronApp) throw new Error('tronApp is missing.')

      const projectName = 'assembly'

      await test.step('Setup parts and expect imported model', async () => {
        await folderSetupFn(async (dir) => {
          const projectDir = path.join(dir, projectName)
          await fsp.mkdir(projectDir, { recursive: true })
          await Promise.all([
            fsp.copyFile(
              executorInputPath('cube.kcl'),
              path.join(projectDir, 'cube.kcl')
            ),
            fsp.copyFile(
              kclSamplesPath(
                path.join(
                  'pipe-flange-assembly',
                  'mcmaster-parts',
                  '98017a257-washer.step'
                )
              ),
              path.join(projectDir, 'foreign.step')
            ),
            fsp.writeFile(
              path.join(projectDir, 'main.kcl'),
              `
import "cube.kcl" as cube
import "foreign.step" as foreign
cube
foreign
  |> translate(x = 40, z = 10)`
            ),
          ])
        })
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.Code)
      })

      await test.step('Change imported kcl file and expect change', async () => {
        await doAndWaitForImageDiff(
          page,
          async () => {
            await folderSetupFn(async (dir) => {
              // Append appearance to the cube.kcl file
              await fsp.appendFile(
                path.join(dir, projectName, 'cube.kcl'),
                `\n  |> appearance(color = "#ff0000")`
              )
            })
            await scene.settled(cmdBar)
            await toolbar.closePane(DefaultLayoutPaneID.Code)
          },
          300
        )
      })

      await test.step('Change imported step file and expect change', async () => {
        // Expect pipe to take over the red cube but leave some space where the washer was
        await doAndWaitForImageDiff(page, async () => {
          await folderSetupFn(async (dir) => {
            // Replace the washer with a pipe
            await fsp.copyFile(
              kclSamplesPath(
                path.join(
                  'pipe-flange-assembly',
                  'mcmaster-parts',
                  '1120t74-pipe.step'
                )
              ),
              path.join(dir, projectName, 'foreign.step')
            )
          })
          await scene.settled(cmdBar)
          await toolbar.closePane(DefaultLayoutPaneID.Code)
        })
      })
    })

    test(`Point-and-click clone`, async ({
      folderSetupFn,
      page,
      homePage,
      scene,
      editor,
      toolbar,
      cmdBar,
      tronApp,
    }) => {
      if (!tronApp) throw new Error('tronApp is missing.')

      const projectName = 'assembly'
      const cloneLine = `clone001 = clone(washer)`

      await test.step('Setup parts and expect imported model', async () => {
        await folderSetupFn(async (dir) => {
          const projectDir = path.join(dir, projectName)
          await fsp.mkdir(projectDir, { recursive: true })
          await Promise.all([
            fsp.copyFile(
              path.join('public', 'kcl-samples', 'washer', 'main.kcl'),
              path.join(projectDir, 'washer.kcl')
            ),
            fsp.writeFile(
              path.join(projectDir, 'main.kcl'),
              `import "washer.kcl" as washer`
            ),
          ])
        })
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.Code)
      })

      await test.step('Clone the part using the feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const op = await toolbar.getFeatureTreeOperation('washer', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-clone').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'objects',
          currentArgValue: '',
          headerArguments: {
            Objects: '',
            VariableName: '',
          },
          highlightedHeaderArg: 'objects',
          commandName: 'Clone',
        })
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'variableName',
          currentArgValue: '',
          headerArguments: {
            Objects: '1 plane',
            VariableName: '',
          },
          highlightedHeaderArg: 'variableName',
          commandName: 'Clone',
        })
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 plane',
            VariableName: 'clone001',
          },
          commandName: 'Clone',
        })
        await cmdBar.submit()
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

        // Expect changes
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(cloneLine, {
          shouldNormalise: true,
        })
        await toolbar.closePane(DefaultLayoutPaneID.Code)
      })

      await test.step('Delete clone using the feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const op = await toolbar.getFeatureTreeOperation('Clone', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

        // Expect empty editor and scene
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.not.toContain(cloneLine, {
          shouldNormalise: true,
        })
      })
    })
  }
)
