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

const includeDownstreamPattern =
  process.env.GUI_FUZZ_TRANSLATE_DOWNSTREAM !== 'none'

test.describe(
  'GUI fuzz exploration: Translate edit with downstream pattern',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test(`edit an upstream translation ${includeDownstreamPattern ? 'before a linear pattern' : 'without a downstream feature'}`, async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const downstreamCode = includeDownstreamPattern
        ? '\npattern001 = patternLinear3d(extrude001, instances = 3, distance = 10, axis = Y)\n'
        : '\n'
      const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 2)
extrude001 = extrude(profile001, length = 6)
translate(extrude001, x = 5)${downstreamCode}`
      const bodies = page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: /^Body \d+$/ })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Load the translation and optional downstream pattern', async () => {
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('translate(extrude001, x = 5)')
          if (includeDownstreamPattern) {
            await editor.expectEditor.toContain(
              'pattern001 = patternLinear3d(extrude001'
            )
          }
          await scene.settled()
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)

          await toolbar.openFeatureTreePane()
          await expect(bodies).toHaveCount(includeDownstreamPattern ? 3 : 1, {
            timeout: 30_000,
          })
          await expect(
            await toolbar.getFeatureTreeOperation('Translate', 0)
          ).toBeVisible()
          if (includeDownstreamPattern) {
            await expect(
              await toolbar.getFeatureTreeOperation('pattern001', 0)
            ).toBeVisible()
          }
          await captureGuiFuzzStep(page, testInfo, 0, 'translate-pattern-seed')
        })

        await test.step('Move the upstream translation from five to six millimeters', async () => {
          const translateOperation = await toolbar.getFeatureTreeOperation(
            'Translate',
            0
          )
          await translateOperation.dblclick()
          await cmdBar.expectCommandName('Translate')

          await cmdBar.clickHeaderArgument('x')
          const xInput = cmdBar.currentArgumentInput.locator('.cm-content')
          await expect(xInput).toBeVisible()
          await xInput.fill('6')
          await captureGuiFuzzStep(page, testInfo, 1, 'upstream-translate-edit')

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(
            page,
            testInfo,
            2,
            'upstream-translate-review'
          )
          await cmdBar.submit()
          await scene.settled()
        })

        await test.step('Verify the translated object and downstream pattern', async () => {
          const finalCode = await editor.getCurrentCode()
          await testInfo.attach(
            'generated-kcl-after-upstream-translate-edit.kcl',
            {
              body: finalCode,
              contentType: 'text/plain',
            }
          )

          await editor.openPane()
          const lintMarker = page.locator('.cm-lint-marker-error')
          if ((await lintMarker.count()) > 0) {
            await lintMarker.first().hover()
            const diagnosticTooltip = page.locator('.cm-tooltip-lint')
            await expect(diagnosticTooltip).toBeVisible()
            await testInfo.attach('post-translate-edit-diagnostic.txt', {
              body: (await diagnosticTooltip.allTextContents()).join('\n'),
              contentType: 'text/plain',
            })
          }

          await editor.closePane()
          await toolbar.openFeatureTreePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(
            page,
            testInfo,
            3,
            'after-upstream-translate-edit'
          )

          const translatedObject = finalCode.match(
            /translate\(\s*([A-Za-z][A-Za-z0-9_]*)\s*,\s*x\s*=\s*6/
          )?.[1]
          expect(translatedObject).toBe('extrude001')
          if (includeDownstreamPattern) {
            expect(finalCode).toMatch(
              /pattern001\s*=\s*patternLinear3d\(\s*extrude001,/
            )
          }
          await expect(lintMarker).toHaveCount(0)
          await expect(bodies).toHaveCount(includeDownstreamPattern ? 3 : 1, {
            timeout: 30_000,
          })
          await expect(
            await toolbar.getFeatureTreeOperation('Translate', 0)
          ).toBeVisible()
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
