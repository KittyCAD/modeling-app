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
  'GUI fuzz exploration: revolve create and edit',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('revolve an offset rectangle 360 degrees and edit it to 180 degrees', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const reviewForm = page.locator('#review-form')
      const [clickFirstCorner] = scene.makeMouseHelpers(0.58, 0.31, {
        format: 'ratio',
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.76, 0.43, {
        format: 'ratio',
      })
      const [clickProfileCenter] = scene.makeMouseHelpers(0.67, 0.37, {
        format: 'ratio',
      })

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Draw an offset rectangle above the X axis', async () => {
          await scene.connectionEstablished()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 0, 'scene-ready')

          await toolbar.startSketchOnDefaultPlane('Top plane')
          await waitForGuiFuzzSketchReady(page, editor, toolbar)
          await toolbar.rectangleBtn.click()
          await clickFirstCorner()
          await clickSecondCorner()
          await editor.expectEditor.toContain(/(rectangle|line|angledLine)/)
          await captureGuiFuzzStep(page, testInfo, 1, 'offset-rectangle-drawn')

          await toolbar.exitSketch()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 2, 'offset-profile-ready')
        })

        await test.step('Revolve the profile 360 degrees around X', async () => {
          await toolbar.revolveButton.click()
          await clickProfileCenter()
          await expect(page.getByTestId('command-bar-continue')).toBeEnabled()
          await captureGuiFuzzStep(
            page,
            testInfo,
            3,
            'revolve-profile-selected'
          )

          await cmdBar.progressCmdBar()
          await cmdBar.selectOption({ name: 'Sketch Axis' }).click()
          await cmdBar.selectOption({ name: 'X Axis' }).click()

          const angleInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(angleInput).toBeVisible()
          await angleInput.fill('360deg')
          await cmdBar.progressCmdBar()
          await expect(reviewForm).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 4, 'full-revolve-review')

          await cmdBar.submit()
          await scene.settled()
          await editor.expectEditor.toContain('revolve(')
          await editor.expectEditor.toContain(/angle\s*=\s*360/)
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)

          await toolbar.openFeatureTreePane()
          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1', exact: true })
          ).toHaveCount(1)
          await expect(
            bodiesPane.getByRole('button', { name: /^Body [2-9]\d*$/ })
          ).toHaveCount(0)

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 5, 'full-revolve-body')
        })

        await test.step('Edit the revolve angle to 180 degrees', async () => {
          const revolveOperation = await toolbar.getFeatureTreeOperation(
            'Revolve',
            0
          )
          await revolveOperation.dblclick({ button: 'left' })
          await cmdBar.expectCommandName('Revolve')

          const angleInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(angleInput).toBeVisible()
          await angleInput.fill('180deg')
          await captureGuiFuzzStep(page, testInfo, 6, 'half-angle-entered')

          await cmdBar.progressCmdBar()
          await expect(reviewForm).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 7, 'half-revolve-review')
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          expect(finalCode.match(/\brevolve\s*\(/g) ?? []).toHaveLength(1)
          expect(finalCode).toMatch(/angle\s*=\s*180/)
          await expect(page.locator('.cm-lint-marker-error')).toHaveCount(0)
          await expect(
            page
              .locator('#bodies-list-pane')
              .getByRole('button', { name: 'Body 1', exact: true })
          ).toHaveCount(1)

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 8, 'half-revolve-body')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
