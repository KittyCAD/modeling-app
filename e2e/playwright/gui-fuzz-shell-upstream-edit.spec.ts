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
  process.env.GUI_FUZZ_SHELL_DOWNSTREAM !== 'none'

test.describe(
  'GUI fuzz exploration: upstream shell edit',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test(`resubmit a shell ${includeDownstreamPattern ? 'before a linear pattern' : 'without a downstream feature'}`, async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const patternCode = includeDownstreamPattern
        ? '\npattern001 = patternLinear3d(shell001, instances = 3, distance = 35, axis = X)\n'
        : '\n'
      const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-10, -10])
  |> line(end = [20, 0], tag = $bottom001)
  |> line(end = [0, 20], tag = $right001)
  |> line(end = [-20, 0], tag = $top001)
  |> close(tag = $left001)
extrude001 = extrude(profile001, length = 20, tagEnd = $capEnd001)
shell001 = shell(extrude001, faces = capEnd001, thickness = 1)${patternCode}`
      const bodies = page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: /^Body \d+$/ })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Load the open-box shell and downstream pattern', async () => {
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain(
            'shell001 = shell(extrude001, faces = capEnd001, thickness = 1)'
          )
          if (includeDownstreamPattern) {
            await editor.expectEditor.toContain(
              'pattern001 = patternLinear3d(shell001'
            )
          }
          await scene.settled()
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)

          await toolbar.openFeatureTreePane()
          await expect
            .poll(() => bodies.count(), { timeout: 30_000 })
            .toBeGreaterThan(0)
          await expect(
            await toolbar.getFeatureTreeOperation('Shell', 0)
          ).toBeVisible()
          if (includeDownstreamPattern) {
            await expect(
              await toolbar.getFeatureTreeOperation('pattern001', 0)
            ).toBeVisible()
          }
          await captureGuiFuzzStep(page, testInfo, 0, 'shell-pattern-seed')
        })

        await test.step('Open the upstream Shell edit and resubmit it unchanged', async () => {
          const shellOperation = await toolbar.getFeatureTreeOperation(
            'Shell',
            0
          )
          await shellOperation.dblclick()
          await cmdBar.expectCommandName('Shell')

          const thicknessInput =
            cmdBar.argumentInput.locator('[contenteditable]')
          await expect(thicknessInput).toBeVisible()
          await expect(thicknessInput).toContainText('1')
          await captureGuiFuzzStep(page, testInfo, 1, 'upstream-shell-edit')

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'upstream-shell-review')
          await cmdBar.submit()
          await scene.settled()
        })

        await test.step('Verify the dependency chain and regenerated bodies', async () => {
          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-shell-edit.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })

          await editor.openPane()
          const lintMarker = page.locator('.cm-lint-marker-error')
          if ((await lintMarker.count()) > 0) {
            await lintMarker.first().hover()
            const diagnosticTooltip = page.locator('.cm-tooltip-lint')
            await expect(diagnosticTooltip).toBeVisible()
            await testInfo.attach('post-shell-edit-diagnostic.txt', {
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
            'after-upstream-shell-edit'
          )

          const shellInput = finalCode.match(
            /shell001\s*=\s*shell\(\s*([A-Za-z][A-Za-z0-9_]*)/
          )?.[1]
          expect(shellInput).toBe('extrude001')
          if (includeDownstreamPattern) {
            expect(finalCode).toMatch(
              /pattern001\s*=\s*patternLinear3d\(\s*shell001,/
            )
          }
          await expect(lintMarker).toHaveCount(0)
          await expect
            .poll(() => bodies.count(), { timeout: 30_000 })
            .toBeGreaterThan(0)
          await expect(
            await toolbar.getFeatureTreeOperation('Shell', 0)
          ).toBeVisible()
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
