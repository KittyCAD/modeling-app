import {
  attachGuiFuzzRuntimeEvents,
  captureGuiFuzzStep,
  GUI_FUZZ_VIEWPORT,
  observeGuiFuzzRuntime,
  prepareGuiFuzzProject,
  setGuiFuzzIsometricView,
  waitForGuiFuzzSketchReady,
} from '@e2e/playwright/guiFuzzUtils'
import { getUtils } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import {
  EXPERIMENTAL_POINT_AND_CLICK_FLAG,
  SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
} from '@src/lib/constants'

test.describe(
  'GUI fuzz exploration: connection recovery',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test('a reviewed extrusion survives one engine disconnect and submits once', async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const utils = await getUtils(page)
      const networkToggle = page.getByTestId(/network-toggle/)
      const reviewForm = page.locator('#review-form')
      const [clickFirstCorner] = scene.makeMouseHelpers(0.34, 0.39, {
        format: 'ratio',
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.66, 0.61, {
        format: 'ratio',
      })
      const [clickProfileCenter] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })
      let connectionForcedOffline = false

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Create a rectangle and stage one extrusion', async () => {
          await scene.connectionEstablished()
          await scene.settled()
          await expect(networkToggle).toContainText(
            /Network health \((Strong|Ok)\)/
          )
          await captureGuiFuzzStep(page, testInfo, 0, 'scene-ready')

          await toolbar.startSketchOnDefaultPlane('Top plane')
          await waitForGuiFuzzSketchReady(page, editor, toolbar)
          await toolbar.rectangleBtn.click()
          await clickFirstCorner()
          await clickSecondCorner()
          await toolbar.exitSketch()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 1, 'profile-ready')

          await toolbar.extrudeButton.click()
          await clickProfileCenter()
          await cmdBar.progressCmdBar()

          const lengthInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(lengthInput).toBeVisible()
          await lengthInput.fill('6mm')
          await cmdBar.progressCmdBar()
          await expect(reviewForm).toBeVisible()
          await expect
            .poll(
              async () =>
                (await editor.getCurrentCode()).match(/\bextrude\s*\(/g)
                  ?.length ?? 0
            )
            .toBe(0)
          await captureGuiFuzzStep(
            page,
            testInfo,
            2,
            'extrude-review-before-disconnect'
          )
        })

        await test.step('Interrupt and recover the modeling connection', async () => {
          await utils.emulateNetworkConditions({
            offline: true,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          })
          connectionForcedOffline = true

          await expect(networkToggle).toContainText('Network health (Offline)')
          await expect(reviewForm).toBeVisible()
          await captureGuiFuzzStep(
            page,
            testInfo,
            3,
            'offline-with-extrude-review'
          )

          await utils.emulateNetworkConditions({
            offline: false,
            latency: 0,
            downloadThroughput: -1,
            uploadThroughput: -1,
          })
          connectionForcedOffline = false

          await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 15_000 })
          await expect(networkToggle).toContainText(
            /Network health \((Strong|Ok)\)/
          )
          await scene.settled()
          await expect(reviewForm).toBeVisible()
          await captureGuiFuzzStep(
            page,
            testInfo,
            4,
            'reconnected-with-extrude-review'
          )
        })

        await test.step('Submit once and verify one extrusion and one body', async () => {
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          expect(finalCode.match(/\bextrude\s*\(/g) ?? []).toHaveLength(1)

          await toolbar.openFeatureTreePane()
          const bodiesPane = page.locator('#bodies-list-pane')
          await expect(bodiesPane).toBeVisible()
          await expect(
            bodiesPane.getByRole('button', { name: 'Body 1', exact: true })
          ).toHaveCount(1)
          await expect(
            bodiesPane.getByRole('button', { name: /^Body [2-9]\d*$/ })
          ).toHaveCount(0)
          await captureGuiFuzzStep(page, testInfo, 5, 'single-body-created')

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(page, testInfo, 6, 'final-isometric')

          await page.waitForTimeout(5_000)
          await captureGuiFuzzStep(
            page,
            testInfo,
            7,
            'final-after-five-seconds'
          )
        })
      } finally {
        if (connectionForcedOffline) {
          await utils
            .emulateNetworkConditions({
              offline: false,
              latency: 0,
              downloadThroughput: -1,
              uploadThroughput: -1,
            })
            .catch(() => undefined)
        }
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
