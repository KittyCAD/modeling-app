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
  'GUI fuzz validation: clone Feature Tree edit stays in place',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('resubmits an existing clone without appending a second declaration', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 5)
extrude001 = extrude(profile001, length = 6)
clone001 = clone(extrude001)`
      const bodies = page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: /^Body \d+$/ })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Load a solid with an existing clone', async () => {
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('clone001 = clone(extrude001)')
          await scene.settled()
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)

          await toolbar.openFeatureTreePane()
          await expect(bodies).toHaveCount(2, { timeout: 30_000 })
          await expect(
            await toolbar.getFeatureTreeOperation('clone001', 0)
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 0, 'clone-seed')
        })

        await test.step('Open the existing Clone from the Feature Tree and resubmit', async () => {
          const cloneOperation = await toolbar.getFeatureTreeOperation(
            'clone001',
            0
          )
          await cloneOperation.dblclick()
          await cmdBar.expectCommandName('Clone')
          await captureGuiFuzzStep(page, testInfo, 1, 'clone-edit')

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'clone-review')
          await cmdBar.submit()
          await scene.settled()
        })

        await test.step('Verify the existing declaration was updated in place', async () => {
          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-clone-edit.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })

          await editor.openPane()
          const lintMarker = page.locator('.cm-lint-marker-error')
          if ((await lintMarker.count()) > 0) {
            await lintMarker.first().hover()
            const diagnosticTooltip = page.locator('.cm-tooltip-lint')
            await expect(diagnosticTooltip).toBeVisible()
            await testInfo.attach('post-clone-edit-diagnostic.txt', {
              body: (await diagnosticTooltip.allTextContents()).join('\n'),
              contentType: 'text/plain',
            })
          }

          await editor.closePane()
          await toolbar.openFeatureTreePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 3, 'after-clone-edit')

          expect(finalCode.match(/\bclone001\s*=\s*clone\(/g)).toHaveLength(1)
          expect(finalCode).toMatch(
            /clone001\s*=\s*clone\(\s*extrude001\s*\)/
          )
          await expect(lintMarker).toHaveCount(0)
          await expect(bodies).toHaveCount(2, { timeout: 30_000 })
          await expect(
            await toolbar.getFeatureTreeOperation('clone001', 0)
          ).toBeVisible()
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
