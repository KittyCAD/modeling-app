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
      code: 'subtract([extrude001], tools = [extrude006])',
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
          './rust/kcl-lib/e2e/executor/inputs/boolean-setup-with'
        ),
        'utf-8'
      )
      await context.addInitScript((file) => {
        localStorage.setItem('persistCode', file)
      }, file)
      await homePage.goToModelingScene()
      await scene.settled(cmdBar)

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

        // For subtract, we need to proceed to the next step before selecting the second object
        if (operationName !== 'subtract') {
          // should down shift key to select multiple objects
          await page.keyboard.down('Shift')
        }

        // Select second object
        await clickSecondObject({ pixelDiff: 50 })

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
              Tool: '1 path',
              Target: '1 path',
            },
            commandName,
          })
        }

        await cmdBar.submit()

        await editor.expectEditor.toContain(operation.code)
      })
    })
  }
})
