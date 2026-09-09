import { closeOnboardingModalIfPresent } from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { LEGACY_SKETCH_MODE_FEATURE_FLAG } from '@src/lib/constants'

test.use({ userFeatures: [LEGACY_SKETCH_MODE_FEATURE_FLAG] })

const WASHER_CODE = `@settings(defaultLengthUnit = in)

innerDiameter = 0.203
outerDiameter = 0.438
thicknessMax = 0.038
thicknessMin = 0.024
washerSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = outerDiameter / 2)

washer = extrude(washerSketch, length = thicknessMax)
faceSketch = startSketchOn(washer, face = END)
faceProfile001 = circle(faceSketch, center = [0, 0], radius = 0.01)`

test(
  'Feature Tree waits for execution before editing a face sketch',
  { tag: ['@desktop', '@web'] },
  async ({ page, homePage, editor, toolbar, scene }, testInfo) => {
    await homePage.goToModelingScene()
    await closeOnboardingModalIfPresent(page)
    await scene.settled()

    let executionHeld = false
    let releaseExecution = () => {}
    const executionGate = new Promise<void>((resolve) => {
      releaseExecution = resolve
    })
    await page.exposeFunction('holdFeatureTreeExecution', async () => {
      executionHeld = true
      await executionGate
    })
    await page.evaluate(() => {
      const rustContext = window.app.singletons.kclManager.rustContext
      const execute = rustContext.execute.bind(rustContext)
      // Finish real Engine execution and live operation callbacks, but hold the
      // result before KclManager publishes the artifact graph for those rows.
      rustContext.execute = async (...args: Parameters<typeof execute>) => {
        rustContext.execute = execute
        const result = await execute(...args)
        const testWindow = window as typeof window & {
          holdFeatureTreeExecution: () => Promise<void>
        }
        await testWindow.holdFeatureTreeExecution()
        return result
      }
    })

    try {
      await editor.replaceCode('', WASHER_CODE)
      await expect.poll(() => executionHeld).toBe(true)
      await toolbar.openFeatureTreePane()
      const faceSketch = await toolbar.getFeatureTreeOperation('Sketch', 1)
      await expect(faceSketch).toBeVisible()
      await expect(faceSketch).toBeDisabled()
      await expect(toolbar.exitSketchBtn).not.toBeVisible()
      await page.screenshot({
        path: testInfo.outputPath('feature-tree-executing.png'),
      })
    } finally {
      releaseExecution()
    }

    await toolbar.editSketch(1)
    await toolbar.expectToolbarMode.toBe('sketching')
    await expect(
      page.getByText(
        'Editing sketches on faces or offset planes through the feature tree is not yet supported. Please double-click the path in the scene for now.',
        { exact: true }
      )
    ).not.toBeVisible()
    await page.screenshot({
      path: testInfo.outputPath('face-sketch-after-execution.png'),
    })
    await toolbar.exitSketch()
    await toolbar.expectToolbarMode.toBe('modeling')
  }
)
