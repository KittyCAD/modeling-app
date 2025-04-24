import path from 'path'
import * as fsp from 'fs/promises'

import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { ToolbarFixture } from '@e2e/playwright/fixtures/toolbarFixture'
import {
  executorInputPath,
  getUtils,
  testsInputPath,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'

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
    { tag: ['@electron'] },
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
      if (!tronApp) {
        fail()
      }

      const midPoint = { x: 500, y: 250 }
      const partPoint = { x: midPoint.x + 30, y: midPoint.y - 30 } // mid point, just off top right
      const defaultPlanesColor: [number, number, number] = [180, 220, 180]
      const partColor: [number, number, number] = [100, 100, 100]
      const tolerance = 50
      const u = await getUtils(page)
      const gizmo = page.locator('[aria-label*=gizmo]')
      const resetCameraButton = page.getByRole('button', { name: 'Reset view' })

      await test.step('Setup parts and expect empty assembly scene', async () => {
        const projectName = 'assembly'
        await context.folderSetupFn(async (dir) => {
          const bracketDir = path.join(dir, projectName)
          await fsp.mkdir(bracketDir, { recursive: true })
          await Promise.all([
            fsp.copyFile(
              executorInputPath('cylinder.kcl'),
              path.join(bracketDir, 'cylinder.kcl')
            ),
            fsp.copyFile(
              executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
              path.join(bracketDir, 'bracket.kcl')
            ),
            fsp.copyFile(
              testsInputPath('cube.step'),
              path.join(bracketDir, 'cube.step')
            ),
            fsp.writeFile(path.join(bracketDir, 'main.kcl'), ''),
          ])
        })
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
        await toolbar.closePane('code')
        await scene.expectPixelColor(defaultPlanesColor, midPoint, tolerance)
      })

      await test.step('Insert kcl as first part as module', async () => {
        await insertPartIntoAssembly(
          'cylinder.kcl',
          'cylinder',
          toolbar,
          cmdBar,
          page
        )
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(
          `
        import "cylinder.kcl" as cylinder
        cylinder
      `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)

        // Check scene for changes
        await toolbar.closePane('code')
        await u.doAndWaitForCmd(async () => {
          await gizmo.click({ button: 'right' })
          await resetCameraButton.click()
        }, 'zoom_to_fit')
        await toolbar.closePane('debug')
        await scene.expectPixelColor(partColor, partPoint, tolerance)
        await toolbar.openPane('code')
      })

      await test.step('Insert kcl second part as module', async () => {
        await insertPartIntoAssembly(
          'bracket.kcl',
          'bracket',
          toolbar,
          cmdBar,
          page
        )
        await editor.expectEditor.toContain(
          `
        import "cylinder.kcl" as cylinder
        import "bracket.kcl" as bracket
        cylinder
        bracket
      `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)
      })

      await test.step('Insert a second time with the same name and expect error', async () => {
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
        await page.keyboard.insertText('bracket')
        await cmdBar.progressCmdBar()
        await expect(
          page.getByText('This variable name is already in use')
        ).toBeVisible()
      })

      await test.step('Insert a second time with a different name and expect error', async () => {
        await page.keyboard.insertText('2')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Path: 'bracket.kcl', LocalName: 'bracket2' },
          commandName: 'Insert',
        })
        await cmdBar.progressCmdBar()
        await editor.expectEditor.toContain(
          `
        import "cylinder.kcl" as cylinder
        import "bracket.kcl" as bracket
        import "bracket.kcl" as bracket2
        cylinder
        bracket
        bracket2
      `,
          { shouldNormalise: true }
        )
        // TODO: update once we have clone() with #6209
      })
    }
  )

  test(
    `Insert the bracket part into an assembly and transform it`,
    { tag: ['@electron'] },
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
      if (!tronApp) {
        fail()
      }

      const midPoint = { x: 500, y: 250 }
      const moreToTheRightPoint = { x: 900, y: 250 }
      const bgColor: [number, number, number] = [30, 30, 30]
      const partColor: [number, number, number] = [100, 100, 100]
      const tolerance = 30
      const u = await getUtils(page)
      const gizmo = page.locator('[aria-label*=gizmo]')
      const resetCameraButton = page.getByRole('button', { name: 'Reset view' })

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
        await toolbar.closePane('code')
      })

      await test.step('Insert kcl as module', async () => {
        await insertPartIntoAssembly(
          'bracket.kcl',
          'bracket',
          toolbar,
          cmdBar,
          page
        )
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(
          `
        import "bracket.kcl" as bracket
        bracket
      `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)

        // Check scene for changes
        await toolbar.closePane('code')
        await u.doAndWaitForCmd(async () => {
          await gizmo.click({ button: 'right' })
          await resetCameraButton.click()
        }, 'zoom_to_fit')
        await toolbar.closePane('debug')
        await scene.expectPixelColor(partColor, midPoint, tolerance)
        await scene.expectPixelColor(bgColor, moreToTheRightPoint, tolerance)
      })

      await test.step('Set translate on module', async () => {
        await toolbar.openPane('feature-tree')

        const op = await toolbar.getFeatureTreeOperation('bracket', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-translate').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'x',
          currentArgValue: '0',
          headerArguments: {
            X: '',
            Y: '',
            Z: '',
          },
          highlightedHeaderArg: 'x',
          commandName: 'Translate',
        })
        await page.keyboard.insertText('100')
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('0.1')
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('0.2')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            X: '100',
            Y: '0.1',
            Z: '0.2',
          },
          commandName: 'Translate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(
          `
        bracket
          |> translate(x = 100, y = 0.1, z = 0.2)
        `,
          { shouldNormalise: true }
        )
        // Expect translated part in the scene
        await scene.expectPixelColor(bgColor, midPoint, tolerance)
        await scene.expectPixelColor(partColor, moreToTheRightPoint, tolerance)
      })

      await test.step('Set rotate on module', async () => {
        await toolbar.closePane('code')
        await toolbar.openPane('feature-tree')

        const op = await toolbar.getFeatureTreeOperation('bracket', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-rotate').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'roll',
          currentArgValue: '0',
          headerArguments: {
            Roll: '',
            Pitch: '',
            Yaw: '',
          },
          highlightedHeaderArg: 'roll',
          commandName: 'Rotate',
        })
        await page.keyboard.insertText('0.1')
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('0.2')
        await cmdBar.progressCmdBar()
        await page.keyboard.insertText('0.3')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: {
            Roll: '0.1',
            Pitch: '0.2',
            Yaw: '0.3',
          },
          commandName: 'Rotate',
        })
        await cmdBar.progressCmdBar()
        await toolbar.closePane('feature-tree')
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(
          `
        bracket
          |> translate(x = 100, y = 0.1, z = 0.2)
          |> rotate(roll = 0.1, pitch = 0.2, yaw = 0.3)
        `,
          { shouldNormalise: true }
        )
        // Expect no change in the scene as the rotations are tiny
        await scene.expectPixelColor(bgColor, midPoint, tolerance)
        await scene.expectPixelColor(partColor, moreToTheRightPoint, tolerance)
      })

      await test.step('Delete the part using the feature tree', async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('bracket', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await toolbar.closePane('feature-tree')

        // Expect empty editor and scene
        await toolbar.openPane('code')
        await editor.expectEditor.not.toContain('import')
        await editor.expectEditor.not.toContain('bracket')
        await editor.expectEditor.not.toContain('|> translate')
        await editor.expectEditor.not.toContain('|> rotate')
        await toolbar.closePane('code')
        await scene.expectPixelColorNotToBe(partColor, midPoint, tolerance)
      })
    }
  )

  test(
    `Insert foreign parts into assembly as whole module import`,
    { tag: ['@electron'] },
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
      if (!tronApp) {
        fail()
      }

      const midPoint = { x: 500, y: 250 }
      const partPoint = { x: midPoint.x + 30, y: midPoint.y - 30 } // mid point, just off top right
      const defaultPlanesColor: [number, number, number] = [180, 220, 180]
      const partColor: [number, number, number] = [150, 150, 150]
      const tolerance = 50

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
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
        await toolbar.closePane('code')
        await scene.expectPixelColor(defaultPlanesColor, midPoint, tolerance)
      })

      await test.step('Insert step part as module', async () => {
        await insertPartIntoAssembly('cube.step', 'cube', toolbar, cmdBar, page)
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(
          `
        import "cube.step" as cube
        cube
      `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)

        await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
        await toolbar.closePane('code')
        await scene.expectPixelColor(partColor, partPoint, tolerance)
      })

      await test.step('Insert second step part by clicking', async () => {
        await toolbar.openPane('files')
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
        await toolbar.closePane('files')
        await toolbar.openPane('code')
        await editor.expectEditor.toContain(
          `
        import "cube.step" as cube
        import "${complexPlmFileName}" as cubeSw
        cube
        cubeSw
      `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)

        await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
        await toolbar.closePane('code')
        await scene.expectPixelColor(partColor, partPoint, tolerance)
      })

      await test.step('Delete first part using the feature tree', async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('cube', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await toolbar.closePane('feature-tree')

        // Expect only the import statement to be there
        await toolbar.openPane('code')
        await editor.expectEditor.not.toContain(`import "cube.step" as cube`)
        await toolbar.closePane('code')
        await editor.expectEditor.toContain(
          `
        import "${complexPlmFileName}" as cubeSw
        cubeSw
      `,
          { shouldNormalise: true }
        )
        await toolbar.closePane('code')
      })

      await test.step('Delete second part using the feature tree', async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation('cubeSw', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await toolbar.closePane('feature-tree')

        // Expect empty editor and scene
        await toolbar.openPane('code')
        await editor.expectEditor.not.toContain(
          `import "${complexPlmFileName}" as cubeSw`
        )
        await editor.expectEditor.not.toContain('cubeSw')
        await toolbar.closePane('code')
        await scene.expectPixelColorNotToBe(partColor, midPoint, tolerance)
      })
    }
  )
})
