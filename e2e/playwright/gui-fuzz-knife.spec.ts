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

const KNIFE_OUTLINE: [number, number][] = [
  [0.28, 0.42],
  [0.46, 0.42],
  [0.5, 0.46],
  [0.72, 0.47],
  [0.8, 0.52],
  [0.5, 0.57],
  [0.46, 0.62],
  [0.28, 0.62],
  [0.28, 0.42],
]

test.describe(
  'GUI fuzz seed: point-and-click knife',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('draw a knife silhouette and extrude it 4 mm', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const outlineClicks = KNIFE_OUTLINE.map(
        ([x, y]) => scene.makeMouseHelpers(x, y, { format: 'ratio' })[0]
      )
      const [clickBladeRegion] = scene.makeMouseHelpers(0.58, 0.52, {
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

        await test.step('Draw and close the knife outline', async () => {
          await toolbar.lineBtn.click()
          await expect(toolbar.lineBtn).toHaveAttribute('aria-pressed', 'true')

          for (const [index, clickOutlinePoint] of outlineClicks.entries()) {
            await clickOutlinePoint()
            if (index > 0) {
              await expect
                .poll(async () => {
                  const code = await editor.getCurrentCode()
                  return (code.match(/\bline\(/g) ?? []).length
                })
                .toBeGreaterThanOrEqual(index)
            }
          }

          await page.keyboard.press('Escape')
          if ((await toolbar.lineBtn.getAttribute('aria-pressed')) === 'true') {
            await toolbar.lineBtn.click()
          }
          await captureGuiFuzzStep(page, testInfo, 2, 'knife-outline-closed')
        })

        await test.step('Exit the knife sketch', async () => {
          await toolbar.exitSketch()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 3, 'knife-sketch-exited')
        })

        await test.step('Select the knife region for extrusion', async () => {
          await toolbar.extrudeButton.click()
          await clickBladeRegion()
          await expect(page.getByTestId('command-bar-continue')).toBeEnabled()
          await captureGuiFuzzStep(page, testInfo, 4, 'knife-region-selected')
        })

        await test.step('Set the knife thickness to 4 mm', async () => {
          await cmdBar.progressCmdBar()
          const lengthInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(lengthInput).toBeVisible()
          await lengthInput.fill('4mm')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 5, 'knife-extrude-review')
        })

        await test.step('Submit and validate the knife solid', async () => {
          await cmdBar.submit()
          await scene.settled()
          await editor.expectEditor.toContain('extrude(')
          await toolbar.openFeatureTreePane()

          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(bodiesPane).toBeVisible()
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1' })
          ).toBeVisible()
          await captureGuiFuzzStep(page, testInfo, 6, 'knife-solid-top-view')

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 7, 'knife-solid-isometric')
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
