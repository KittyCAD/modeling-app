import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
  setGuiFuzzIsometricView,
} from '@e2e/playwright/guiFuzzUtils'
import { expect, test } from '@e2e/playwright/zoo-test'
import type { Page } from '@playwright/test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

const activeCase = process.env.GUI_FUZZ_PIPE_CODEMOD_CASE ?? 'all'

function shouldRun(caseName: string) {
  return activeCase === 'all' || activeCase === caseName
}

async function expectNoLintErrors(page: Page) {
  await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
}

test.describe(
  'GUI fuzz validation: variable-less pipe codemods',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    ;(shouldRun('object-delete') ? test : test.skip)(
      'delete appends to a selected variable-less body pipe',
      async ({ cmdBar, editor, page, scene, toolbar }, testInfo) => {
        const runtimeEvents = observeGuiFuzzRuntime(page)
        const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`

        try {
          await page.setViewportSize(GUI_FUZZ_VIEWPORT)
          await prepareGuiFuzzProject(page, editor)
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('|> extrude(length = 1)')
          await scene.settled()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 0, 'delete-source-pipe-seed')

          await toolbar.selectTransform('delete')
          await cmdBar.expectCommandName('Delete')
          await editor.selectText('extrude(length = 1)')
          await captureGuiFuzzStep(page, testInfo, 1, 'delete-source-selected')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'delete-review')
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-delete.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })
          expect(finalCode).toContain(
            `  |> extrude(length = 1)
  |> delete()`
          )
          expect(finalCode).not.toContain('delete001 = delete()')
          await editor.openPane()
          await expectNoLintErrors(page)
          await editor.closePane()
          await captureGuiFuzzStep(page, testInfo, 3, 'after-delete')
        } finally {
          await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
        }
      }
    )

    ;(shouldRun('object-delete-multi') ? test : test.skip)(
      'delete preserves two selected variable-less body pipes',
      async ({ cmdBar, editor, page, scene, toolbar }, testInfo) => {
        const runtimeEvents = observeGuiFuzzRuntime(page)
        const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)
startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)
  |> extrude(length = 1)`

        try {
          await page.setViewportSize(GUI_FUZZ_VIEWPORT)
          await prepareGuiFuzzProject(page, editor)
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('extrude(length = 1)')
          await scene.settled()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await toolbar.openFeatureTreePane()
          await captureGuiFuzzStep(
            page,
            testInfo,
            0,
            'delete-multi-source-pipe-seed'
          )

          await toolbar.selectTransform('delete')
          await cmdBar.expectCommandName('Delete')
          await page.keyboard.down('Shift')
          await (await toolbar.getFeatureTreeOperation('Extrude', 0)).click()
          await (await toolbar.getFeatureTreeOperation('Extrude', 1)).click()
          await page.keyboard.up('Shift')
          await expect(toolbar.selectionStatus).toContainText('2')
          await captureGuiFuzzStep(
            page,
            testInfo,
            1,
            'delete-multi-source-selected'
          )

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'delete-multi-review')
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-multi-delete.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })
          expect(finalCode).toContain('solid001 = startSketchOn(XY)')
          expect(finalCode).toContain('solid002 = startSketchOn(XZ)')
          expect(finalCode).toContain('delete([solid001, solid002])')
          await editor.openPane()
          await expectNoLintErrors(page)
          await editor.closePane()
          await captureGuiFuzzStep(page, testInfo, 3, 'after-delete-multi')
        } finally {
          await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
        }
      }
    )

    ;(shouldRun('boolean-subtract-tool') ? test : test.skip)(
      'subtract materializes a selected variable-less tool pipe',
      async ({ cmdBar, editor, page, scene, toolbar }, testInfo) => {
        const runtimeEvents = observeGuiFuzzRuntime(page)
        const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = startSketchOn(XY)
profile001 = circle(sketch001, center = [0, 0], radius = 2)
extrude001 = extrude(profile001, length = 2)
startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)`

        try {
          await page.setViewportSize(GUI_FUZZ_VIEWPORT)
          await prepareGuiFuzzProject(page, editor)
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('extrude001 = extrude')
          await scene.settled()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 0, 'subtract-tool-pipe-seed')

          await toolbar.selectBoolean('subtract')
          await cmdBar.expectCommandName('Boolean Subtract')
          await editor.selectText(
            'extrude001 = extrude(profile001, length = 2)'
          )
          await captureGuiFuzzStep(
            page,
            testInfo,
            1,
            'subtract-target-selected'
          )
          await cmdBar.progressCmdBar()
          await editor.selectText('extrude(length = 2)')
          await captureGuiFuzzStep(page, testInfo, 2, 'subtract-tool-selected')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 3, 'subtract-review')
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-subtract.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })
          expect(finalCode).toContain('solid001 = startSketchOn(XZ)')
          expect(finalCode).toContain(
            'solid002 = subtract(extrude001, tools = solid001)'
          )
          await editor.openPane()
          await expectNoLintErrors(page)
          await editor.closePane()
          await captureGuiFuzzStep(page, testInfo, 4, 'after-subtract')
        } finally {
          await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
        }
      }
    )

    ;(shouldRun('sweep-path') ? test : test.skip)(
      'sweep materializes a selected variable-less path pipe',
      async ({ cmdBar, editor, page, scene, toolbar }, testInfo) => {
        const runtimeEvents = observeGuiFuzzRuntime(page)
        const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 5])`

        try {
          await page.setViewportSize(GUI_FUZZ_VIEWPORT)
          await prepareGuiFuzzProject(page, editor)
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('profile001 = startSketchOn(XY)')
          await scene.settled()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 0, 'sweep-path-pipe-seed')

          await toolbar.sweepButton.click()
          await cmdBar.expectCommandName('Sweep')
          await editor.selectText('profile001 = startSketchOn(XY)')
          await captureGuiFuzzStep(page, testInfo, 1, 'sweep-profile-selected')
          await cmdBar.progressCmdBar()
          await editor.selectText('line(end = [0, 5])')
          await captureGuiFuzzStep(page, testInfo, 2, 'sweep-path-selected')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 3, 'sweep-review')
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-sweep.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })
          expect(finalCode).toContain('path001 = startSketchOn(XZ)')
          expect(finalCode).toContain('sweep001 = sweep(')
          expect(finalCode).toContain('path = path001')
          await editor.openPane()
          await expectNoLintErrors(page)
          await editor.closePane()
          await captureGuiFuzzStep(page, testInfo, 4, 'after-sweep')
        } finally {
          await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
        }
      }
    )

    ;(shouldRun('plane-mirror') ? test : test.skip)(
      'mirror materializes a selected variable-less plane pipe',
      async ({ cmdBar, editor, page, scene, toolbar }, testInfo) => {
        const runtimeEvents = observeGuiFuzzRuntime(page)
        const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

profile001 = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1)
extrude001 = extrude(profile001, length = 1)
offsetPlane(YZ, offset = 2)`

        try {
          await page.setViewportSize(GUI_FUZZ_VIEWPORT)
          await prepareGuiFuzzProject(page, editor)
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('offsetPlane(YZ, offset = 2)')
          await scene.settled()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 0, 'plane-pipe-seed')

          await toolbar.selectTransform('mirror3d')
          await cmdBar.expectCommandName('Mirror')
          await editor.selectText(
            'extrude001 = extrude(profile001, length = 1)'
          )
          await captureGuiFuzzStep(page, testInfo, 1, 'mirror-body-selected')
          await cmdBar.progressCmdBar()
          await editor.selectText('offsetPlane(YZ, offset = 2)')
          await captureGuiFuzzStep(page, testInfo, 2, 'mirror-plane-selected')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 3, 'mirror-review')
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-mirror.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })
          expect(finalCode).toContain('plane001 = offsetPlane(YZ, offset = 2)')
          expect(finalCode).toContain(
            'solid001 = mirror3d(extrude001, across = plane001)'
          )
          await editor.openPane()
          await expectNoLintErrors(page)
          await editor.closePane()
          await captureGuiFuzzStep(page, testInfo, 4, 'after-mirror')
        } finally {
          await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
        }
      }
    )

    ;(shouldRun('multi-transform') ? test : test.skip)(
      'translate preserves two selected variable-less body pipes',
      async ({ cmdBar, editor, page, scene, toolbar }, testInfo) => {
        const runtimeEvents = observeGuiFuzzRuntime(page)
        const seedCode = `@settings(defaultLengthUnit = mm, kclVersion = 2.0)

startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)
startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 2)
  |> extrude(length = 2)`

        try {
          await page.setViewportSize(GUI_FUZZ_VIEWPORT)
          await prepareGuiFuzzProject(page, editor)
          await scene.connectionEstablished()
          await editor.replaceCode('', seedCode)
          await editor.expectEditor.toContain('extrude(length = 2)')
          await scene.settled()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await toolbar.openFeatureTreePane()
          await captureGuiFuzzStep(page, testInfo, 0, 'multi-transform-seed')

          await toolbar.selectTransform('translate')
          await cmdBar.expectCommandName('Translate')
          await page.keyboard.down('Shift')
          await (await toolbar.getFeatureTreeOperation('Extrude', 0)).click()
          await (await toolbar.getFeatureTreeOperation('Extrude', 1)).click()
          await page.keyboard.up('Shift')
          await expect(toolbar.selectionStatus).toContainText('2')
          await captureGuiFuzzStep(
            page,
            testInfo,
            1,
            'multi-transform-selected'
          )

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'multi-transform-review')
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-multi-translate.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })
          expect(finalCode).toContain('solid001 = startSketchOn(XY)')
          expect(finalCode).toContain('solid002 = startSketchOn(XZ)')
          expect(finalCode).toContain('translate([solid001, solid002], x = 5)')
          expect(finalCode).not.toContain('[%, %]')
          await editor.openPane()
          await expectNoLintErrors(page)
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 3, 'after-multi-transform')
        } finally {
          await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
        }
      }
    )
  }
)
