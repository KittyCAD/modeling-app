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
  'GUI fuzz exploration: extrusion history',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('undo removes an extrusion and redo restores its body', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const [clickFirstCorner] = scene.makeMouseHelpers(0.34, 0.39, {
        format: 'ratio',
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.66, 0.61, {
        format: 'ratio',
      })
      const [clickProfileCenter] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Create and submit the extrusion', async () => {
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
          await lengthInput.fill('6mm')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 2, 'extrude-review')

          await cmdBar.submit()
          await scene.settled()
          await editor.expectEditor.toContain('extrude(')
          await toolbar.openFeatureTreePane()

          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 3, 'body-before-undo')
        })

        const bodiesPane = page.locator('#bodies-list-pane')

        await test.step('Undo removes extrusion code and Body 1', async () => {
          await page.keyboard.press('ControlOrMeta+z')
          await expect
            .poll(async () =>
              (await editor.getCurrentCode()).includes('extrude(')
            )
            .toBe(false)
          await scene.settled()
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toHaveCount(0)
          await captureGuiFuzzStep(page, testInfo, 4, 'extrusion-undone')
        })

        await test.step('Redo restores extrusion code and Body 1', async () => {
          await page.keyboard.press('ControlOrMeta+Shift+z')
          await expect
            .poll(async () =>
              (await editor.getCurrentCode()).includes('extrude(')
            )
            .toBe(true)
          await scene.settled()
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 5, 'extrusion-redone')

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 6, 'redo-isometric')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
