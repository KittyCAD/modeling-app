import { resetView } from '@e2e/playwright/lib/sceneSupport'
import { getEndCapId } from '@e2e/playwright/lib/solidSelection'
import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'
import fs from 'node:fs/promises'
import path from 'node:path'

test.use({ useTestSettings: true })

test.describe(
  'Point and click for boolean workflows - sketch v1',
  { tag: '@web' },
  () => {
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
      {
        name: 'split',
        code: 'split([extrude001, extrude006])',
      },
    ] as const
    for (let i = 0; i < booleanOperations.length; i++) {
      const operation = booleanOperations[i]
      const operationName = operation.name
      const commandName = `Boolean ${
        operationName.charAt(0).toUpperCase() + operationName.slice(1)
      }`
      for (const rendererTag of ['@localRenderer', '@streamRenderer']) {
        test(`Create boolean operation -- ${operationName} ${rendererTag}`, async ({
          homePage,
          modelingDialog,
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
          await homePage.goToModelingScene()
          await scene.settled()
          await scene.waitForExecutionDoneAfter(() =>
            editor.replaceCode('', file)
          )
          await resetView(scene)
          await toolbar.closePane(DefaultLayoutPaneID.Code)

          await test.step(`Test ${operationName} operation`, async () => {
            // Click the boolean operation button in the toolbar
            if (operationName === 'split') {
              await toolbar.splitButton.click()
            } else {
              await toolbar.selectBoolean(operationName)
            }

            await expect(modelingDialog.locator).toHaveAttribute(
              'aria-label',
              commandName
            )
            const targets = modelingDialog.selection(
              operationName === 'split' ? 'Targets' : 'Solids'
            )
            await expect(targets).toHaveAttribute('aria-pressed', 'true')
            // Select first object in the scene, expect there to be a pixel diff from the selection color change
            const [clickFirstObject] = await scene.makeSelectionHelpers({
              kind: 'bodyFace',
              id:
                rendererTag === '@localRenderer'
                  ? await getEndCapId(page, 'extrude001')
                  : undefined,
              stream: { x: 592, y: 174, format: 'pixels' },
            })
            await clickFirstObject({ pixelDiff: 50 })
            await expect(targets).toHaveText('1 sweep')

            // For subtract, select the tool separately.
            if (operationName !== 'subtract') {
              // should down shift key to select multiple objects
              await page.keyboard.down('Shift')
            } else {
              await modelingDialog.selection('Tools').click()
              await expect(modelingDialog.selection('Tools')).toHaveAttribute(
                'aria-pressed',
                'true'
              )
            }

            // Local selection resolves asynchronously; keep Shift held until both
            // bodies are selected rather than releasing it on the first pixel diff.
            try {
              // extrude002's cap is visible on the solid later modified by extrude006.
              const [clickSecondObject] = await scene.makeSelectionHelpers({
                kind: 'bodyFace',
                id:
                  rendererTag === '@localRenderer'
                    ? await getEndCapId(page, 'extrude002')
                    : undefined,
                stream: { x: 500, y: 300, format: 'pixels' },
              })
              await clickSecondObject({ pixelDiff: 50 })

              if (operationName === 'subtract') {
                await expect(modelingDialog.selection('Solids')).toHaveText(
                  '1 sweep'
                )
                await expect(modelingDialog.selection('Tools')).toHaveText(
                  '1 sweep'
                )
              } else {
                await expect(
                  modelingDialog.selection(
                    operationName === 'split' ? 'Targets' : 'Solids'
                  )
                ).toHaveText('2 sweeps')
              }
            } finally {
              await page.keyboard.up('Shift')
            }
            await modelingDialog.submit()
            await scene.settled()
            await editor.openPane()
            await editor.scrollToText(operation.code)
            await editor.expectEditor.toContain(operation.code)
          })

          await test.step(`Delete ${operationName} operation via feature tree selection`, async () => {
            await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
            const op = await toolbar.getFeatureTreeOperation(
              operationName === 'split' ? 'split001' : 'solid001',
              0
            )
            await op.click({ button: 'right' })
            await page.getByTestId('context-menu-delete').click()
            await scene.settled()
            await toolbar.closePane(DefaultLayoutPaneID.FeatureTree)

            // Expect changes in ft and code
            await editor.expectEditor.not.toContain(operation.code)
            await expect(
              await toolbar.getFeatureTreeOperation(operationName, 0)
            ).not.toBeVisible()
          })
        })
      }
    }
  }
)
