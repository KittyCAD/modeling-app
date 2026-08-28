import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
  waitForGuiFuzzSketchReady,
} from '@e2e/playwright/guiFuzzUtils'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

test.describe(
  'GUI fuzz seed: point-and-click modeling',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('draw a rectangle on the Top plane and extrude it 5 mm', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const [clickFirstCorner] = scene.makeMouseHelpers(0.35, 0.35, {
        format: 'ratio',
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.65, 0.65, {
        format: 'ratio',
      })
      const [clickProfileCenter] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Wait for the empty modeling scene', async () => {
          await scene.connectionEstablished()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 0, 'scene-ready')
        })

        await test.step('Start a sketch on the Top plane', async () => {
          await toolbar.startSketchOnDefaultPlane('Top plane')
          await waitForGuiFuzzSketchReady(page, editor, toolbar)
          await captureGuiFuzzStep(page, testInfo, 1, 'top-plane-sketch-ready')
        })

        await test.step('Draw a corner rectangle with two clicks', async () => {
          await toolbar.rectangleBtn.click()
          await clickFirstCorner()
          await clickSecondCorner()
          await editor.expectEditor.toContain(/(rectangle|line|angledLine)/)
          await captureGuiFuzzStep(page, testInfo, 2, 'rectangle-drawn')
        })

        await test.step('Exit the sketch', async () => {
          await toolbar.exitSketch()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 3, 'sketch-exited')
        })

        await test.step('Select the rectangle region for extrusion', async () => {
          await toolbar.extrudeButton.click()
          await clickProfileCenter()
          await expect(page.getByTestId('command-bar-continue')).toBeEnabled()
          await captureGuiFuzzStep(
            page,
            testInfo,
            4,
            'extrude-profile-selected'
          )
        })

        await test.step('Set the extrusion length to 5 mm', async () => {
          await cmdBar.progressCmdBar()
          const lengthInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(lengthInput).toBeVisible()
          await lengthInput.fill('5mm')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 5, 'extrude-review')
        })

        await test.step('Submit the extrusion and verify Body 1', async () => {
          await cmdBar.submit()
          await scene.settled()
          await editor.expectEditor.toContain('extrude(')
          await toolbar.openFeatureTreePane()

          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(bodiesPane).toBeVisible()
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 6, 'body-1-created')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
