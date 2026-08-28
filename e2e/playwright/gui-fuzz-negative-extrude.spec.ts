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
  'GUI fuzz exploration: negative extrusion',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('extrude a point-and-click rectangle negative 5 mm', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const [clickFirstCorner] = scene.makeMouseHelpers(0.36, 0.38, {
        format: 'ratio',
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.64, 0.62, {
        format: 'ratio',
      })
      const [clickProfileCenter] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Create a closed rectangle profile', async () => {
          await scene.connectionEstablished()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 0, 'scene-ready')

          await toolbar.startSketchOnDefaultPlane('Top plane')
          await waitForGuiFuzzSketchReady(page, editor, toolbar)
          await toolbar.rectangleBtn.click()
          await clickFirstCorner()
          await clickSecondCorner()
          await editor.expectEditor.toContain(/(rectangle|line|angledLine)/)
          await captureGuiFuzzStep(page, testInfo, 1, 'rectangle-drawn')

          await toolbar.exitSketch()
          await scene.settled()
        })

        await test.step('Preview a negative 5 mm extrusion', async () => {
          await toolbar.extrudeButton.click()
          await clickProfileCenter()
          await expect(page.getByTestId('command-bar-continue')).toBeEnabled()
          await cmdBar.progressCmdBar()

          const lengthInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(lengthInput).toBeVisible()
          await lengthInput.fill('-5mm')
          await expect(page.getByTestId('command-bar-continue')).toBeEnabled()
          await captureGuiFuzzStep(page, testInfo, 2, 'negative-length-entered')

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await expect(
            page
              .getByTestId('arg-name-length')
              .locator('..')
              .getByTestId('header-arg-value')
          ).toContainText('-5')
          await captureGuiFuzzStep(page, testInfo, 3, 'negative-review')
        })

        await test.step('Submit and verify the reversed body', async () => {
          await cmdBar.submit()
          await scene.settled()
          await editor.expectEditor.toContain('extrude(')
          await editor.expectEditor.toContain(/length\s*=\s*-5/)
          await toolbar.openFeatureTreePane()

          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toBeVisible()

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 4, 'negative-body')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
