import fs from 'node:fs/promises'
import path from 'node:path'
import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
  setGuiFuzzIsometricView,
} from '@e2e/playwright/guiFuzzUtils'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

test.describe(
  'GUI fuzz exploration: boolean subtraction history',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('subtract two solids, undo, and redo the boolean', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const [clickTargetSolid] = scene.makeMouseHelpers(0.4, 0.7, {
        debugLabel: 'Boolean target solid',
        format: 'ratio',
        steps: 10,
      })
      const [clickToolSolid] = scene.makeMouseHelpers(0.56, 0.18, {
        debugLabel: 'Boolean tool solid',
        format: 'ratio',
        steps: 10,
      })
      const seedCode = await fs.readFile(
        path.resolve(
          __dirname,
          '../../rust/kcl-lib/e2e/executor/inputs/boolean-setup-with-sketch-solve-on-faces.kcl'
        ),
        'utf8'
      )
      const booleanCode = 'subtract(extrude001, tools = extrude002)'
      let codeAfterSubtract = ''
      const bodies = page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: /^Body \d+$/ })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Load and verify the multi-body seed', async () => {
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('extrude006')
          await scene.settled()
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)

          await toolbar.openFeatureTreePane()
          await expect(bodies).toHaveCount(6, { timeout: 30_000 })
          await toolbar.closeFeatureTreePane()
          await captureGuiFuzzStep(page, testInfo, 0, 'six-body-seed')
        })

        await test.step('Select the target and tool solids', async () => {
          await toolbar.selectBoolean('subtract')
          await cmdBar.expectCommandName('Boolean Subtract')

          await clickTargetSolid({ pixelDiff: 50 })
          await expect(toolbar.selectionStatus).toContainText('1')
          await captureGuiFuzzStep(page, testInfo, 1, 'target-selected')
          await cmdBar.progressCmdBar()

          await clickToolSolid({ pixelDiff: 50 })
          await expect(toolbar.selectionStatus).toContainText('1')
          await captureGuiFuzzStep(page, testInfo, 2, 'tool-selected')
          await cmdBar.progressCmdBar()

          await cmdBar.expectState({
            stage: 'review',
            headerArguments: {
              Solids: '1 region',
              Tools: '1 region',
            },
            commandName: 'Boolean Subtract',
          })
          await captureGuiFuzzStep(page, testInfo, 3, 'subtract-review')
        })

        await test.step('Submit the subtraction', async () => {
          await cmdBar.submit()
          await scene.settled()
          await editor.expectEditor.toContain(booleanCode)

          codeAfterSubtract = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-subtract.kcl', {
            body: codeAfterSubtract,
            contentType: 'text/plain',
          })

          await toolbar.openFeatureTreePane()
          await expect(bodies).toHaveCount(5, { timeout: 30_000 })
          await expect(
            await toolbar.getFeatureTreeOperation('solid001', 0)
          ).toBeVisible()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 4, 'subtract-applied')
        })

        await test.step('Undo restores both input solids', async () => {
          await page.keyboard.press('ControlOrMeta+z')
          await expect
            .poll(async () =>
              (await editor.getCurrentCode()).includes('subtract(')
            )
            .toBe(false)
          await scene.settled()
          await expect(bodies).toHaveCount(6, { timeout: 30_000 })
          await captureGuiFuzzStep(page, testInfo, 5, 'subtract-undone')
        })

        await test.step('Redo restores the subtraction', async () => {
          await page.keyboard.press('ControlOrMeta+Shift+z')
          await expect
            .poll(async () =>
              (await editor.getCurrentCode()).includes('subtract(')
            )
            .toBe(true)
          await expect
            .poll(() => editor.getCurrentCode(), { timeout: 30_000 })
            .toBe(codeAfterSubtract)
          await scene.settled()
          await expect(bodies).toHaveCount(5, { timeout: 30_000 })
          await expect(
            await toolbar.getFeatureTreeOperation('solid001', 0)
          ).toBeVisible()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 6, 'subtract-redone')
        })

        await test.step('Reload preserves the redone boolean', async () => {
          await page.reload({ waitUntil: 'domcontentloaded' })
          await scene.connectionEstablished()
          await scene.settled()

          await expect
            .poll(() => editor.getCurrentCode(), { timeout: 30_000 })
            .toBe(codeAfterSubtract)
          await toolbar.openFeatureTreePane()
          await expect(bodies).toHaveCount(5, { timeout: 30_000 })
          await expect(
            await toolbar.getFeatureTreeOperation('solid001', 0)
          ).toBeVisible()

          await editor.openPane()
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 7, 'subtract-after-reload')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
