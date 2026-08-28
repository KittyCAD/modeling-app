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

const configuredHoleCount = Number.parseInt(
  process.env.GUI_FUZZ_HOLE_COUNT ?? '4',
  10
)
if (
  !Number.isInteger(configuredHoleCount) ||
  configuredHoleCount < 1 ||
  configuredHoleCount > 4
) {
  throw new Error('GUI_FUZZ_HOLE_COUNT must be an integer from 1 through 4')
}
const configuredEditMode = process.env.GUI_FUZZ_HOLE_EDIT_MODE ?? 'countersink'
if (!['countersink', 'resubmit'].includes(configuredEditMode)) {
  throw new Error(
    'GUI_FUZZ_HOLE_EDIT_MODE must be either countersink or resubmit'
  )
}

test.describe(
  'GUI fuzz exploration: four-hole mounting plate',
  { tag: ['@web', '@gui-fuzz'] },
  () => {
    test.use({
      userFeatures: [
        EXPERIMENTAL_POINT_AND_CLICK_FLAG,
        SEGMENTS_BASED_REGIONS_FEATURE_FLAG,
      ],
    })

    test(`build ${configuredHoleCount} chained holes and ${configuredEditMode} the first`, async ({
      cmdBar,
      editor,
      page,
      scene,
      toolbar,
    }, testInfo) => {
      const runtimeEvents = observeGuiFuzzRuntime(page)
      const [clickFirstCorner] = scene.makeMouseHelpers(0.28, 0.34, {
        format: 'ratio',
      })
      const [clickSecondCorner] = scene.makeMouseHelpers(0.72, 0.66, {
        format: 'ratio',
      })
      const [clickProfileCenter] = scene.makeMouseHelpers(0.5, 0.5, {
        format: 'ratio',
      })
      const [clickTopFace] = scene.makeMouseHelpers(0.5, 0.4, {
        debugLabel: 'Plate top face',
        format: 'ratio',
      })

      async function applyBlindHole({
        cutAt,
        screenshotIndex,
      }: {
        cutAt: [number, number]
        screenshotIndex: number
      }) {
        await toolbar.holeButton.click()
        await cmdBar.expectCommandName('Hole')
        await clickTopFace()
        await expect(toolbar.selectionStatus).toContainText('1 face')
        await cmdBar.progressCmdBar()

        await expect(page.getByTestId('vector2d-x-input')).toBeVisible()
        await page.getByTestId('vector2d-x-input').fill(String(cutAt[0]))
        await page.getByTestId('vector2d-y-input').fill(String(cutAt[1]))
        await cmdBar.progressCmdBar()

        await cmdBar.selectOption({ name: 'Blind' }).click()
        const depthInput = cmdBar.argumentInput.locator('[contenteditable]')
        await expect(depthInput).toBeVisible()
        await depthInput.fill('1.4mm')
        await cmdBar.progressCmdBar()

        const diameterInput = cmdBar.argumentInput.locator('[contenteditable]')
        await expect(diameterInput).toBeVisible()
        await diameterInput.fill('0.7mm')
        await cmdBar.progressCmdBar()

        await cmdBar.selectOption({ name: 'Simple' }).click()
        await cmdBar.selectOption({ name: 'Flat' }).click()
        await expect(page.locator('#review-form')).toBeVisible()
        await captureGuiFuzzStep(
          page,
          testInfo,
          screenshotIndex,
          `hole-${screenshotIndex - 2}-review`
        )
        await cmdBar.submit()
        await scene.settled()
      }

      try {
        await page.setViewportSize(GUI_FUZZ_VIEWPORT)
        await prepareGuiFuzzProject(page, editor)

        await test.step('Create the mounting plate blank', async () => {
          await scene.connectionEstablished()
          await scene.settled()
          await captureGuiFuzzStep(page, testInfo, 0, 'scene-ready')

          await toolbar.startSketchOnDefaultPlane('Top plane')
          await waitForGuiFuzzSketchReady(page, editor, toolbar)
          await toolbar.rectangleBtn.click()
          await clickFirstCorner()
          await clickSecondCorner()
          await captureGuiFuzzStep(page, testInfo, 1, 'plate-profile')

          await toolbar.exitSketch()
          await scene.settled()
          await toolbar.extrudeButton.click()
          await clickProfileCenter()
          await cmdBar.progressCmdBar()

          const lengthInput = cmdBar.argumentInput.locator('[contenteditable]')
          await expect(lengthInput).toBeVisible()
          await lengthInput.fill('2mm')
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
          await captureGuiFuzzStep(page, testInfo, 2, 'plate-blank')

          await toolbar.closeFeatureTreePane()
          await editor.closePane()
          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
        })

        const holeLocations: [number, number][] = [
          [-1.8, -1.2],
          [1.8, -1.2],
          [1.8, 1.2],
          [-1.8, 1.2],
        ].slice(0, configuredHoleCount) as [number, number][]

        for (const [index, cutAt] of holeLocations.entries()) {
          await test.step(`Add blind mounting hole ${index + 1}`, async () => {
            await applyBlindHole({ cutAt, screenshotIndex: index + 3 })
            const code = await editor.getCurrentCode()
            expect(code.match(/hole::hole\(/g) ?? []).toHaveLength(index + 1)
            await captureGuiFuzzStep(
              page,
              testInfo,
              index + 7,
              `hole-${index + 1}-applied`
            )
          })
        }

        await test.step(`${configuredEditMode} the first hole`, async () => {
          await toolbar.openFeatureTreePane()
          const firstHole = await toolbar.getFeatureTreeOperation('Hole', 0)
          await firstHole.dblclick()
          await cmdBar.expectCommandName('Hole')
          await cmdBar.progressCmdBar()
          await expect(page.locator('#review-form')).toBeVisible()

          if (configuredEditMode === 'countersink') {
            await page.getByRole('button', { name: 'HoleType' }).click()
            await cmdBar.selectOption({ name: 'Countersink' }).click()

            const angleInput = cmdBar.argumentInput.locator('[contenteditable]')
            await expect(angleInput).toBeVisible()
            await angleInput.fill('82deg')
            await cmdBar.progressCmdBar()

            const countersinkDiameterInput =
              cmdBar.argumentInput.locator('[contenteditable]')
            await expect(countersinkDiameterInput).toBeVisible()
            await countersinkDiameterInput.fill('1.4mm')
            await cmdBar.progressCmdBar()
          }

          await expect(page.locator('#review-form')).toBeVisible()
          await captureGuiFuzzStep(
            page,
            testInfo,
            11,
            `upstream-${configuredEditMode}-review`
          )
          await cmdBar.submit()
          await scene.settled()

          const finalCode = await editor.getCurrentCode()
          await testInfo.attach('generated-kcl-after-upstream-edit.kcl', {
            body: finalCode,
            contentType: 'text/plain',
          })
          expect(finalCode.match(/hole::hole\(/g) ?? []).toHaveLength(
            holeLocations.length
          )
          if (configuredEditMode === 'countersink') {
            expect(finalCode).toContain('hole::countersink')
            expect(finalCode).toContain('angle = 82deg')
            expect(finalCode).toContain('diameter = 1.4mm')
          } else {
            expect(finalCode).toContain('hole::simple')
          }

          await editor.openPane()
          const lintMarker = page.locator('.cm-lint-marker-error')
          if ((await lintMarker.count()) > 0) {
            await lintMarker.first().hover()
            const diagnosticTooltip = page.locator('.cm-tooltip-lint')
            await expect(diagnosticTooltip).toBeVisible()
            const diagnosticText = await diagnosticTooltip.allTextContents()
            await testInfo.attach('post-upstream-edit-diagnostic.txt', {
              body: diagnosticText.join('\n'),
              contentType: 'text/plain',
            })
          }

          await setGuiFuzzIsometricView(page)
          await page.waitForTimeout(600)
          await captureGuiFuzzStep(
            page,
            testInfo,
            12,
            `after-upstream-${configuredEditMode}`
          )

          const firstHoleInput = finalCode.match(
            /hole001\s*=\s*hole::hole\(\s*([A-Za-z][A-Za-z0-9_]*)/
          )?.[1]
          expect(firstHoleInput).toBe('extrude001')
          await expect(lintMarker).toHaveCount(0)
          await expect(
            toolbar.featureTreePane.getByRole('button', { name: 'Hole' })
          ).toHaveCount(holeLocations.length)
          await expect(
            page
              .locator('#bodies-list-pane')
              .getByRole('button', { name: 'Body 1' })
          ).toBeVisible()

          await captureGuiFuzzStep(
            page,
            testInfo,
            13,
            `four-hole-plate-after-${configuredEditMode}`
          )
        })
      } finally {
        await attachGuiFuzzRuntimeEvents(testInfo, runtimeEvents)
      }
    })
  }
)
