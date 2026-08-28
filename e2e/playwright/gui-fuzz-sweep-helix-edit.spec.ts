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
  'GUI fuzz exploration: sweep helix edit',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('sweep a circle region along a helix and edit sectional mode', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const reviewForm = page.locator('#review-form')
      const bodies = page
        .locator('#bodies-list-pane')
        .getByRole('button', { name: /^Body \d+$/ })
      const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

helix001 = helix(
  axis = X,
  radius = 1,
  length = 10,
  revolutions = 10,
  angleStart = 0,
  ccw = false,
)

sketch001 = sketch(on = XZ) {
  circle001 = circle(start = [0.1mm, -1mm], center = [0mm, -1mm])
}
region001 = region(segments = [sketch001.circle001])
`

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Load a helix path and circular profile region', async () => {
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('helix001 = helix(')
          await editor.expectEditor.toContain(
            'region001 = region(segments = [sketch001.circle001])'
          )
          await scene.settled()

          await toolbar.openFeatureTreePane()
          await expect(
            await toolbar.getFeatureTreeOperation('Helix', 0)
          ).toBeVisible()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 0, 'helix-profile-seed')
        })

        await test.step('Create a Sweep using the region and helix path', async () => {
          await toolbar.sweepButton.click()
          await cmdBar.expectCommandName('Sweep')

          await editor.selectText('region001 = region(')
          await captureGuiFuzzStep(page, testInfo, 1, 'sweep-profile-selected')
          await cmdBar.progressCmdBar()

          const helix = await toolbar.getFeatureTreeOperation('Helix', 0)
          await helix.click()
          await captureGuiFuzzStep(page, testInfo, 2, 'sweep-path-selected')
          await cmdBar.progressCmdBar()

          await expect(reviewForm).toBeVisible()
          await expect(
            page.getByRole('button', { name: /Profiles\s*:\s*1 region/i })
          ).toBeVisible()
          await expect(
            page.getByRole('button', { name: /Path\s*:\s*1 helix/i })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 3, 'sweep-review')

          await cmdBar.submit()
          await scene.settled()

          const sweepCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-sweep.kcl', {
            body: sweepCode,
            contentType: 'text/plain',
          })
          expect(sweepCode.match(/\bsweep\s*\(/g) ?? []).toHaveLength(1)
          expect(sweepCode).toContain('sweep001 = sweep(')
          expect(sweepCode).toContain('region001,')
          expect(sweepCode).toContain('path = helix001')
          expect(sweepCode).toContain('version = 2')
          expect(sweepCode).toContain('translateProfileToPath = false')
          expect(sweepCode).toContain('orientProfilePerpendicular = false')
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)

          await toolbar.openFeatureTreePane()
          await expect(
            await toolbar.getFeatureTreeOperation('Sweep', 0)
          ).toBeVisible()
          await expect.poll(() => bodies.count(), { timeout: 30_000 }).toBe(1)
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 4, 'sweep-body')
        })

        await test.step('Edit the Sweep to enable sectional mode', async () => {
          const sweepOperation = await toolbar.getFeatureTreeOperation(
            'Sweep',
            0
          )
          await sweepOperation.dblclick({ button: 'left' })
          await cmdBar.expectCommandName('Sweep')
          await expect(reviewForm).toBeVisible()

          await cmdBar.clickOptionalArgument('sectional')
          await cmdBar.selectOption({ name: 'On', exact: true }).click()
          await expect(reviewForm).toBeVisible()
          await expect(
            page.getByRole('button', { name: /Sectional\s*:\s*true/i })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 5, 'sweep-sectional-review')

          await cmdBar.submit()
          await scene.settled()

          const editedCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-sweep-edit.kcl', {
            body: editedCode,
            contentType: 'text/plain',
          })
          expect(editedCode.match(/\bsweep\s*\(/g) ?? []).toHaveLength(1)
          expect(editedCode).toContain('sectional = true')
          expect(editedCode).toContain('path = helix001')
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await expect.poll(() => bodies.count(), { timeout: 30_000 }).toBe(1)

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 6, 'sweep-sectional-body')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
