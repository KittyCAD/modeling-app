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
  process.env.GUI_FUZZ_PATTERN_DOWNSTREAM !== 'none'

test.describe(
  'GUI fuzz exploration: chained linear pattern edit',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test(`edit an upstream pattern ${includeDownstreamPattern ? 'before a second pattern' : 'without a downstream feature'}`, async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const downstreamCode = includeDownstreamPattern
        ? '\npattern002 = patternLinear3d(pattern001, instances = 2, distance = 8, axis = Y)\n'
        : '\n'
      const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 2)
extrude001 = extrude(profile001, length = 6)
pattern001 = patternLinear3d(extrude001, instances = 3, distance = 8, axis = X)${downstreamCode}`
      const bodies = page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: /^Body \d+$/ })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Load the chained linear-pattern seed', async () => {
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain(
            'pattern001 = patternLinear3d(extrude001'
          )
          if (includeDownstreamPattern) {
            await editor.expectEditor.toContain(
              'pattern002 = patternLinear3d(pattern001'
            )
          }
          await scene.settled()
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)

          await toolbar.openFeatureTreePane()
          await expect(bodies).toHaveCount(includeDownstreamPattern ? 6 : 3, {
            timeout: 30_000,
          })
          await expect(
            await toolbar.getFeatureTreeOperation('pattern001', 0)
          ).toBeVisible()
          if (includeDownstreamPattern) {
            await expect(
              await toolbar.getFeatureTreeOperation('pattern002', 0)
            ).toBeVisible()
          }
          await captureGuiFuzzStep(page, testInfo, 0, 'chained-pattern-seed')
        })

        await test.step('Increase the first pattern from three to four instances', async () => {
          const firstPattern = await toolbar.getFeatureTreeOperation(
            'pattern001',
            0
          )
          await firstPattern.dblclick()
          await cmdBar.expectCommandName('Pattern Linear 3D')

          await page.getByRole('button', { name: 'Instances' }).click()
          const instancesInput =
            cmdBar.currentArgumentInput.locator('.cm-content')
          await expect(instancesInput).toBeVisible()
          await instancesInput.fill('4')
          await captureGuiFuzzStep(page, testInfo, 1, 'upstream-pattern-edit')

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'upstream-pattern-review')
          await cmdBar.submit()
          await scene.settled()
        })

        await test.step('Verify both pattern dependencies and regenerated bodies', async () => {
          const finalCode = await editor.getCurrentCode()
          await testInfo.attach(
            'generated-kcl-after-upstream-pattern-edit.kcl',
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
            await testInfo.attach('post-pattern-edit-diagnostic.txt', {
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
            'after-upstream-pattern-edit'
          )

          const firstPatternInput = finalCode.match(
            /pattern001\s*=\s*patternLinear3d\(\s*([A-Za-z][A-Za-z0-9_]*)/
          )?.[1]
          expect(firstPatternInput).toBe('extrude001')
          expect(finalCode).toMatch(
            /pattern001\s*=\s*patternLinear3d\(\s*extrude001,\s*instances\s*=\s*4,/
          )
          if (includeDownstreamPattern) {
            expect(finalCode).toMatch(
              /pattern002\s*=\s*patternLinear3d\(\s*pattern001,/
            )
          }
          await expect(lintMarker).toHaveCount(0)
          await expect(bodies).toHaveCount(includeDownstreamPattern ? 8 : 4, {
            timeout: 30_000,
          })
          await expect(
            await toolbar.getFeatureTreeOperation('pattern001', 0)
          ).toBeVisible()
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
