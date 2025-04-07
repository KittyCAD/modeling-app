import * as fsp from 'fs/promises'
import path from 'path'

import { executorInputPath } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

// test file is for testing point an click code gen functionality that's assemblies related
test.describe('Point-and-click assemblies tests', () => {
  test(
    `Insert kcl part into assembly as whole module import`,
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

      // One dumb hardcoded screen pixel value
      const testPoint = { x: 575, y: 200 }
      const initialColor: [number, number, number] = [50, 50, 50]
      const partColor: [number, number, number] = [150, 150, 150]
      const tolerance = 50

      await test.step('Setup parts and expect empty assembly scene', async () => {
        const projectName = 'assembly'
        await context.folderSetupFn(async (dir) => {
          const bracketDir = path.join(dir, projectName)
          await fsp.mkdir(bracketDir, { recursive: true })
          await Promise.all([
            fsp.copyFile(
              executorInputPath('cylinder-inches.kcl'),
              path.join(bracketDir, 'cylinder.kcl')
            ),
            fsp.copyFile(
              executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
              path.join(bracketDir, 'bracket.kcl')
            ),
            fsp.writeFile(path.join(bracketDir, 'main.kcl'), ''),
          ])
        })
        await page.setBodyDimensions({ width: 1000, height: 500 })
        await homePage.openProject(projectName)
        await scene.settled(cmdBar)
        await scene.expectPixelColor(initialColor, testPoint, tolerance)
      })

      await test.step('Insert first part into the assembly', async () => {
        await toolbar.insertButton.click()
        await cmdBar.selectOption({ name: 'cylinder.kcl' }).click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'localName',
          currentArgValue: '',
          headerArguments: { Path: 'cylinder.kcl', LocalName: '' },
          highlightedHeaderArg: 'localName',
          commandName: 'Insert',
        })
        await expect(cmdBar.argumentInput).toHaveValue('part001')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Path: 'cylinder.kcl', LocalName: 'part001' },
          commandName: 'Insert',
        })
        await cmdBar.progressCmdBar()
        await editor.expectEditor.toContain(
          `
        import "cylinder.kcl" as part001
        part001
      `,
          { shouldNormalise: true }
        )
        await scene.settled(cmdBar)
        await scene.expectPixelColor(partColor, testPoint, tolerance)
      })

      await test.step('Insert second part into the assembly', async () => {
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
        await expect(cmdBar.argumentInput).toHaveValue('part002')
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
        import "cylinder.kcl" as part001
        import "bracket.kcl" as bracket
        part001
        bracket
      `,
          { shouldNormalise: true }
        )
      })
    }
  )
})
