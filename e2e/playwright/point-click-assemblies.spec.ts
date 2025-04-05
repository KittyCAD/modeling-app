import * as fsp from 'fs/promises'
import path from 'path'

import { executorInputPath } from '@e2e/playwright/test-utils'
import { test } from '@e2e/playwright/zoo-test'

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
      const partColor: [number, number, number] = [150, 150, 150]
      const tolerance = 50

      await page.setBodyDimensions({ width: 1000, height: 500 })
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
      await homePage.openProject(projectName)
      await scene.waitForExecutionDone()

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
        await page.keyboard.insertText('cylinder')
        await cmdBar.progressCmdBar()
        await cmdBar.expectState({
          stage: 'review',
          headerArguments: { Path: 'cylinder.kcl', LocalName: 'cylinder' },
          commandName: 'Insert',
        })
        await cmdBar.progressCmdBar()
        await editor.expectEditor.toContain(
          `
        import "cylinder.kcl" as cylinder
        cylinder
      `,
          { shouldNormalise: true }
        )
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
        cylinder
        bracket
      `,
          { shouldNormalise: true }
        )
      })
    }
  )

  // TODO: figure out if this should live as part of the insert test.
  // Had to separate them due hasExpressionStatement in enterTransformFlow
  // evaluating to false on first insert.
  test(
    `Set transforms on assembly parts with whole module import`,
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

      const initialCode = `import "cylinder.kcl" as cylinder
import "bracket.kcl" as bracket
cylinder
bracket
`
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
          fsp.writeFile(path.join(bracketDir, 'main.kcl'), initialCode),
        ])
      })
      await homePage.openProject(projectName)
      await scene.waitForExecutionDone()

      await test.step('Set transform on the first part', async () => {
        await toolbar.closePane('code')
        await toolbar.openPane('feature-tree')

        const op = await toolbar.getFeatureTreeOperation('cylinder', 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-set-transform').click()
        await cmdBar.expectState({
          stage: 'arguments',
          currentArgKey: 'tx',
          currentArgValue: '0',
          headerArguments: {
            Tx: '',
            Ty: '',
            Tz: '',
            Rr: '',
            Rp: '',
            Ry: '',
          },
          highlightedHeaderArg: 'tx',
          commandName: 'Transform',
        })
        await cmdBar.progressCmdBar()
        await cmdBar.progressCmdBar()
        await cmdBar.progressCmdBar()
        await cmdBar.progressCmdBar()
        await cmdBar.progressCmdBar()
        await cmdBar.progressCmdBar()
        await cmdBar.progressCmdBar()
        // TODO: this below doesn't actually execute because cylinder doesn't return a solid.
        // This is a broader discussion to have
        await editor.expectEditor.toContain(
          `
        cylinder
          |> translate(
              %,
              x = 0,
              y = 0,
              z = 0,
            )
          |> rotate(
              %,
              roll = 0,
              pitch = 0,
              yaw = 0,
            )
      `,
          { shouldNormalise: true }
        )
      })
    }
  )
})
