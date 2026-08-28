import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
  setGuiFuzzIsometricView,
  waitForGuiFuzzSketchReady,
} from '@e2e/playwright/guiFuzzUtils'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

test.describe(
  'GUI fuzz exploration: sketch edit regeneration',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('move an extruded rectangle vertex and regenerate its body', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const [clickFirstCorner] = scene.makeMouseHelpers(0.35, 0.38, {
        format: 'ratio',
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.65, 0.62, {
        format: 'ratio',
      })
      const [clickProfileCenter] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Create a rectangle extrusion', async () => {
          await scene.connectionEstablished()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 0, 'scene-ready')

          await toolbar.startSketchOnDefaultPlane('Top plane')
          await waitForGuiFuzzSketchReady(page, editor, toolbar)
          await toolbar.rectangleBtn.click()
          await clickFirstCorner()
          await clickSecondCorner()
          await captureGuiFuzzStep(page, testInfo, 1, 'rectangle-drawn')

          await toolbar.exitSketch()
          await scene.settled()
          await toolbar.extrudeButton.click()
          await clickProfileCenter()
          await cmdBar.progressCmdBar()

          const lengthInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(lengthInput).toBeVisible()
          await lengthInput.fill('5mm')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await cmdBar.submit()
          await scene.settled()
          await editor.expectEditor.toContain('extrude(')
          await toolbar.openFeatureTreePane()

          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 2, 'body-before-edit')
        })

        await test.step('Enter sketch edit mode and drag one vertex', async () => {
          await toolbar.editSketch()
          const pointHandles = page.locator(
            '[data-handle="sketch-point-handle"]'
          )
          await expect
            .poll(() => pointHandles.count())
            .toBeGreaterThanOrEqual(4)
          await captureGuiFuzzStep(page, testInfo, 3, 'sketch-edit-ready')

          const codeBeforeDrag = await editor.getCurrentCode()
          const handleBox = await pointHandles.first().boundingBox()
          if (!handleBox) {
            throw new Error(
              'Expected the first sketch point handle to be visible'
            )
          }

          const handleX = handleBox.x + handleBox.width / 2
          const handleY = handleBox.y + handleBox.height / 2
          await page.mouse.move(handleX, handleY)
          await page.mouse.down()
          await page.mouse.move(handleX + 45, handleY + 30, { steps: 8 })
          await page.mouse.up()

          await expect
            .poll(() => editor.getCurrentCode())
            .not.toBe(codeBeforeDrag)
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await expect
            .poll(() => pointHandles.count())
            .toBeGreaterThanOrEqual(4)
          await captureGuiFuzzStep(page, testInfo, 4, 'vertex-moved')
        })

        await test.step('Exit sketch edit and verify regeneration', async () => {
          await toolbar.exitSketch()
          await scene.settled()
          await editor.expectEditor.toContain('extrude(')
          await captureGuiFuzzStep(page, testInfo, 5, 'after-sketch-exit')

          const lintMarker = page.locator('.cm-lint-marker-error')
          if ((await lintMarker.count()) > 0) {
            await lintMarker.first().hover()
            const diagnosticTooltip = page.locator('.cm-tooltip-lint')
            await expect(diagnosticTooltip).toBeVisible()
            const diagnosticText = await diagnosticTooltip.allTextContents()
            await testInfo.attach('post-edit-diagnostic.txt', {
              body: diagnosticText.join('\n'),
              contentType: 'text/plain',
            })
            await captureGuiFuzzStep(page, testInfo, 6, 'post-edit-diagnostic')
          }
          await expect(lintMarker).toHaveCount(0)
          await toolbar.openFeatureTreePane()

          const extrudeOperation = toolbar.featureTreePane
            .getByRole('button', { name: /^(Extrude|extrude001)$/ })
            .first()
          await expect(extrudeOperation).toBeVisible()

          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 7, 'body-regenerated')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
