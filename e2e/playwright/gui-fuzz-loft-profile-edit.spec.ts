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
  'GUI fuzz exploration: loft profile edit',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('loft two segmented circle regions and edit the V degree', async ({
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

lowerSketch = sketch(on = XY) {
  lowerCircle = circle(center = [0mm, 0mm], start = [10mm, 0mm])
}
lowerRegion = region(segments = [lowerSketch.lowerCircle])

offset001 = 20mm
upperPlane = offsetPlane(XY, offset = offset001)
upperSketch = sketch(on = upperPlane) {
  upperCircle = circle(center = [2mm, 0mm], start = [8mm, 0mm])
}
upperRegion = region(segments = [upperSketch.upperCircle])
`

      async function selectLoftRegions() {
        const multiCursorKey = process.platform === 'linux' ? 'Control' : 'Meta'
        await editor.selectText('lowerRegion = region(')
        await page.keyboard.down(multiCursorKey)
        await page.getByText('upperRegion = region(').click()
        await page.keyboard.up(multiCursorKey)
      }

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Load two offset segmented regions', async () => {
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain(
            'lowerRegion = region(segments = [lowerSketch.lowerCircle])'
          )
          await editor.expectEditor.toContain(
            'upperRegion = region(segments = [upperSketch.upperCircle])'
          )
          await scene.settled()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)

          await toolbar.openFeatureTreePane()
          await expect(
            await toolbar.getFeatureTreeOperation('upperPlane', 0)
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 0, 'two-region-seed')
        })

        await test.step('Create a loft from the two regions', async () => {
          await toolbar.loftButton.click()
          await cmdBar.expectCommandName('Loft')
          await selectLoftRegions()
          await captureGuiFuzzStep(page, testInfo, 1, 'loft-regions-selected')

          await cmdBar.progressCmdBar()
          await expect(reviewForm).toBeVisible()
          await expect(
            page.getByRole('button', { name: /Profiles\s*:\s*2 regions/i })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'loft-review')

          await cmdBar.submit()
          await scene.settled()

          const loftCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-loft.kcl', {
            body: loftCode,
            contentType: 'text/plain',
          })
          expect(loftCode.match(/\bloft\s*\(/g) ?? []).toHaveLength(1)
          expect(loftCode).toContain(
            'loft001 = loft([lowerRegion, upperRegion])'
          )
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)

          await toolbar.openFeatureTreePane()
          await expect(
            await toolbar.getFeatureTreeOperation('Loft', 0)
          ).toBeVisible()
          await expect.poll(() => bodies.count(), { timeout: 30_000 }).toBe(1)
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 3, 'loft-body')
        })

        await test.step('Edit the loft V degree from the Feature Tree', async () => {
          const loftOperation = await toolbar.getFeatureTreeOperation('Loft', 0)
          await loftOperation.dblclick({ button: 'left' })
          await cmdBar.expectCommandName('Loft')
          await expect(reviewForm).toBeVisible()

          await cmdBar.clickOptionalArgument('vDegree')
          const vDegreeInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(vDegreeInput).toBeVisible()
          await vDegreeInput.fill('3')
          await cmdBar.progressCmdBar()
          await expect(reviewForm).toBeVisible()
          await expect(
            page.getByRole('button', { name: /VDegree\s*:\s*3/i })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 4, 'loft-v-degree-review')

          await cmdBar.submit()
          await scene.settled()

          const editedCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-loft-edit.kcl', {
            body: editedCode,
            contentType: 'text/plain',
          })
          expect(editedCode.match(/\bloft\s*\(/g) ?? []).toHaveLength(1)
          expect(editedCode).toContain(
            'loft001 = loft([lowerRegion, upperRegion], vDegree = 3)'
          )
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await expect.poll(() => bodies.count(), { timeout: 30_000 }).toBe(1)

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 5, 'loft-edited-body')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
