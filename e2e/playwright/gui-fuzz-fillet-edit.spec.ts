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
  'GUI fuzz exploration: fillet apply and edit',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('fillet a point-and-click extrusion edge and edit its radius', async ({
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
      const [clickFrontVerticalEdge] = scene.makeMouseHelpers(0.518, 0.6, {
        debugLabel: 'Fillet edge',
        format: 'ratio',
      })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Create a rectangular extrusion', async () => {
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
          await lengthInput.fill('8mm')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await cmdBar.submit()
          await scene.settled()

          await toolbar.openFeatureTreePane()
          await expect(
            page
              .locator('#bodies-list-pane')
              .getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 2, 'body-before-fillet')
        })

        await test.step('Select one solid edge', async () => {
          await clickFrontVerticalEdge()
          await expect(toolbar.selectionStatus).toContainText('1 edge')
          await captureGuiFuzzStep(page, testInfo, 3, 'edge-selected')
        })

        await test.step('Apply a 1 mm fillet', async () => {
          await toolbar.filletButton.click()
          await cmdBar.expectCommandName('Fillet')
          await cmdBar.progressCmdBar()

          const radiusInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(radiusInput).toBeVisible()
          await radiusInput.fill('1mm')
          await captureGuiFuzzStep(page, testInfo, 4, 'fillet-radius-entered')

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 5, 'fillet-review')
          await cmdBar.submit()
          await scene.settled()

          await editor.expectEditor.toContain('fillet(')
          await editor.expectEditor.toContain(/radius\s*=\s*1/)
          await expect(
            await toolbar.getFeatureTreeOperation('Fillet', 0)
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 6, 'fillet-applied')
        })

        await test.step('Edit the fillet radius to 0.5 mm', async () => {
          const filletOperation = await toolbar.getFeatureTreeOperation(
            'Fillet',
            0
          )
          await filletOperation.dblclick({ button: 'left' })
          await cmdBar.expectCommandName('Fillet')

          const radiusInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(radiusInput).toBeVisible()
          await radiusInput.fill('0.5mm')
          await captureGuiFuzzStep(page, testInfo, 7, 'edited-radius-entered')

          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 8, 'edited-fillet-review')
          await cmdBar.submit()
          await scene.settled()

          await editor.expectEditor.toContain(/radius\s*=\s*0\.5/)
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await expect(
            page
              .locator('#bodies-list-pane')
              .getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 9, 'edited-fillet-body')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
