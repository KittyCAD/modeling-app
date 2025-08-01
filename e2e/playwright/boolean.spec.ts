import fs from 'node:fs/promises'
import path from 'node:path'

import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Point and click for boolean workflows', () => {
  // Boolean operations to test
  const booleanOperations = [
    {
      name: 'union',
      code: 'union([extrude001, extrude006])',
    },
    {
      name: 'subtract',
      code: 'subtract(extrude001, tools = extrude006)',
    },
    {
      name: 'intersect',
      code: 'intersect([extrude001, extrude006])',
    },
  ] as const
  for (let i = 0; i < booleanOperations.length; i++) {
    const operation = booleanOperations[i]
    const operationName = operation.name
    const commandName = `Boolean ${
      operationName.charAt(0).toUpperCase() + operationName.slice(1)
    }`
    test(`Create boolean operation -- ${operationName}`, async ({
      context,
      homePage,
      cmdBar,
      editor,
      toolbar,
      scene,
      page,
    }) => {
      const file = await fs.readFile(
        path.resolve(
          __dirname,
          '../../',
          './rust/kcl-lib/e2e/executor/inputs/boolean-setup-with-sketch-on-faces.kcl'
        ),
        'utf-8'
      )
      await context.addInitScript((file) => {
        localStorage.setItem('persistCode', file)
      }, file)
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)
      await toolbar.closePane('code')

      // Test coordinates for selection - these might need adjustment based on actual scene layout
      const cylinderPoint = { x: 592, y: 174 }
      const secondObjectPoint = { x: 683, y: 273 }

      // Create mouse helpers for selecting objects
      const [clickFirstObject] = scene.makeMouseHelpers(
        cylinderPoint.x,
        cylinderPoint.y,
        { steps: 10 }
      )
      const [clickSecondObject] = scene.makeMouseHelpers(
        secondObjectPoint.x,
        secondObjectPoint.y,
        { steps: 10 }
      )

      await test.step(`Test ${operationName} operation`, async () => {
        // Click the boolean operation button in the toolbar
        await toolbar.selectBoolean(operationName)

        // Verify command bar is showing the right command
        await expect(cmdBar.page.getByTestId('command-name')).toContainText(
          commandName
        )

        // Select first object in the scene, expect there to be a pixel diff from the selection color change
        await clickFirstObject({ pixelDiff: 50 })
        await page.waitForTimeout(1000)

        // For subtract, we need to proceed to the next step before selecting the second object
        if (operationName !== 'subtract') {
          // should down shift key to select multiple objects
          await page.keyboard.down('Shift')
        } else {
          await cmdBar.progressCmdBar()
        }

        // Select second object
        await clickSecondObject({ pixelDiff: 50 })

        await page.waitForTimeout(1000)

        // Confirm the operation in the command bar
        await cmdBar.progressCmdBar()

        if (operationName === 'union' || operationName === 'intersect') {
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Solids: '2 paths',
            },
            commandName,
          })
        } else if (operationName === 'subtract') {
          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Solids: '1 path',
              Tools: '1 path',
            },
            commandName,
          })
        }

        await cmdBar.submit()
        await scene.settled(cmdBar)
        await editor.openPane()
        await editor.scrollToText(operation.code)
        await editor.expectEditor.toContain(operation.code)
      })

      await test.step(`Delete ${operationName} operation via feature tree selection`, async () => {
        await toolbar.openPane('feature-tree')
        const op = await toolbar.getFeatureTreeOperation(operationName, 0)
        await op.click({ button: 'right' })
        await page.getByTestId('context-menu-delete').click()
        await scene.settled(cmdBar)
        await toolbar.closePane('feature-tree')

        // Expect changes in ft and code
        await editor.expectEditor.not.toContain(operation.code)
        await expect(
          await toolbar.getFeatureTreeOperation(operationName, 0)
        ).not.toBeVisible()
      })
    })
  }
})
