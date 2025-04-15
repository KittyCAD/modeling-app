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

      await test.step('Insert a second time and expect error', async () => {
        // TODO: revisit once we have clone with #6209
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
        import "bracket.kcl" as bracket
        cylinder
        bracket
        bracket
      `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)
        await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
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

        // TODO: remove this once #5780 is fixed
        await page.reload()

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

        // TODO: remove this once #5780 is fixed
        await page.reload()
        await scene.settled(cmdBar)

        await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
        await toolbar.closePane('code')
        await scene.expectPixelColor(partColor, partPoint, tolerance)
      })
    }
  )
})
