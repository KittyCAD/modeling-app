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
import type { Page } from '@playwright/test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

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
test.describe('Point-and-click assemblies tests', () => {
  test(
    `Insert kcl parts into assembly as whole module import`,
    { tag: ['@desktop', '@macos', '@windows'] },
    async ({
      context,
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
        await context.folderSetupFn(async (dir) => {
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
        await page.waitForTimeout(10000)
        await editor.expectEditor.toContain(
          `
          import "nested/twice/main.kcl" as main
          `,
          { shouldNormalise: true }
        )
      })
    }
  )

  test(
    `Insert the bracket part into an assembly and transform it`,
    { tag: ['@desktop', '@macos', '@windows'] },
    async ({
      context,
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
        await context.folderSetupFn(async (dir) => {
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
        await page.setBodyDimensions({ width: 1000, height: 500 })
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

        const op = await toolbar.getFeatureTreeOperation('bracket', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-translate').click()
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
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 other',
          },
          commandName: 'Translate',
        })
        await cmdBar.clickOptionalArgument('x')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'x',
          currentArgValue: '0',
          headerArguments: {
            Objects: '1 other',
            X: '',
          },
          highlightedHeaderArg: 'x',
          commandName: 'Translate',
        })
        await page.keyboard.insertText('100')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 other',
            X: '100',
          },
          commandName: 'Translate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(`translate(bracket, x = 100)`, {
          shouldNormalise: true,
        })
      })

      await test.step('Set scale on module', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)

        const op = await toolbar.getFeatureTreeOperation('bracket', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-scale').click()
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
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 other',
          },
          commandName: 'Scale',
        })
        await cmdBar.clickOptionalArgument('x')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'x',
          currentArgValue: '0',
          headerArguments: {
            Objects: '1 other',
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
            Objects: '1 other',
            X: '1.1',
          },
          commandName: 'Scale',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `translate(bracket, x = 100)
          scale(bracket, x = 1.1)`,
          { shouldNormalise: true }
        )
      })

      await test.step('Set rotate on module', async () => {
        await toolbar.closePane(DefaultLayoutPaneID.Code)
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)

        const op = await toolbar.getFeatureTreeOperation('bracket', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-rotate').click()
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
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 other',
          },
          commandName: 'Rotate',
        })
        await cmdBar.clickOptionalArgument('roll')
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'roll',
          currentArgValue: '0',
          headerArguments: {
            Objects: '1 other',
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
            Objects: '1 other',
            Roll: '0.1',
          },
          commandName: 'Rotate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)
        await toolbar.openPane(DefaultLayoutPaneID.Code)
        await editor.expectEditor.toContain(
          `
          translate(bracket, x = 100)
          scale(bracket, x = 1.1)
          rotate(bracket, roll = 0.1)
          `,
          { shouldNormalise: true }
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
        const opb = await toolbar.getFeatureTreeOperation('bracket', 0)
        await opb.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
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
  )

  test(
    `Insert foreign parts into assembly and delete them`,
    { tag: ['@desktop', '@macos', '@windows'] },
    async ({
      context,
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
        await context.folderSetupFn(async (dir) => {
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

      // TODO: enable once deleting the first import is fixed
      // await test.step('Delete first part using the feature tree', async () => {
      //   page.on('console', console.log)
      //   await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
      //   const op = await toolbar.getFeatureTreeOperation('cube', 0)
      //   await op.click({ button: 'right' })
      //   await page.getByTestId('context-menu-delete').click()
      //   await scene.settled(cmdBar)
      //   await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

      //   // Expect only the import statement to be there
      //   await toolbar.openPane(DefaultLayoutPaneID.Code)
      //   await editor.expectEditor.not.toContain(`import "cube.step" as cube`)
      //   await toolbar.closePane(DefaultLayoutPaneID.Code)
      //   await editor.expectEditor.toContain(
      //     `
      //     import "${complexPlmFileName}" as cubeSw
      //   `,
      //     { shouldNormalise: true }
      //   )
      //   await toolbar.closePane(DefaultLayoutPaneID.Code)
      // })

      await test.step('Delete second part using the feature tree', async () => {
        await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
        const op = await toolbar.getFeatureTreeOperation('cube_Complex', 0)
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
        // TODO: enable once deleting the first import is fixed
        // don't re-enable because we don't want pixel-based tests anymore, but the behavior
        // still needs fixed.
        // await scene.expectPixelColorNotToBe(partColor, midPoint, tolerance)
      })
    }
  )

  test(
    'Assembly gets reexecuted when imported models are updated externally',
    { tag: ['@desktop', '@macos', '@windows'] },
    async ({ context, page, homePage, scene, toolbar, cmdBar, tronApp }) => {
      if (!tronApp) throw new Error('tronApp is missing.')

      const projectName = 'assembly'

      await test.step('Setup parts and expect imported model', async () => {
        await context.folderSetupFn(async (dir) => {
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
            await context.folderSetupFn(async (dir) => {
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
          await context.folderSetupFn(async (dir) => {
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
    }
  )

  test(
    `Point-and-click clone`,
    { tag: ['@desktop', '@macos', '@windows'] },
    async ({
      context,
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
        await context.folderSetupFn(async (dir) => {
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
            Objects: '1 other',
            VariableName: '',
          },
          highlightedHeaderArg: 'variableName',
          commandName: 'Clone',
        })
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Objects: '1 other',
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
    }
  )
})
