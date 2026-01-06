import { expect, test } from '@e2e/playwright/zoo-test'
import { DefaultLayoutPaneID } from '@src/lib/layout/configs/default'

/**
 * Benchmark tests for the first things an user would do in the app.
 * This is meant to represent user behavior, and changes to that are owned by our group of
 * mechanical engineers. See .github/CODEOWNERS for more details.
 */

test.describe('Hot path', () => {
  test(`Draw a circle and extrude it`, async ({
    page,
    homePage,
    scene,
    editor,
    toolbar,
    cmdBar,
  }) => {
    // Open an empty project
    await page.setBodyDimensions({ width: 1500, height: 1000 })
    await homePage.goToModelingScene()
    await scene.settled(cmdBar)

    // Default layout
    await toolbar.openPane(DefaultLayoutPaneID.FeatureTree)
    await toolbar.openPane(DefaultLayoutPaneID.Code)

    // Mouse helpers
    const [clickCenter] = scene.makeMouseHelpers(0.5, 0.5, { format: 'ratio' })
    const [clickABitOffCenter] = scene.makeMouseHelpers(0.55, 0.45, {
      format: 'ratio',
    })

    // Default step timeout
    const timeout = 500

    await test.step('Start sketch', async () => {
      await toolbar.startSketchBtn.click()
      await page.waitForTimeout(timeout)
      await clickABitOffCenter()
      await page.waitForTimeout(timeout)
    })

    await test.step('Draw circle', async () => {
      await toolbar.circleBtn.click()
      await page.waitForTimeout(timeout)
      await clickCenter()
      await page.waitForTimeout(timeout)
      await clickABitOffCenter()
      await page.waitForTimeout(timeout)
    })

    await test.step('Exit sketch, expect feature tree update', async () => {
      await toolbar.exitSketchBtn.click()
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('circle(')
      await expect(
        await toolbar.getFeatureTreeOperation('sketch001', 0)
      ).toBeVisible()
    })

    await test.step('Click Extrude and select circle profile', async () => {
      await toolbar.extrudeButton.click()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'sketches',
        currentArgValue: '',
        headerArguments: {
          Profiles: '',
          Length: '5',
        },
        highlightedHeaderArg: 'Profiles',
        commandName: 'Extrude',
      })
      await clickCenter()
    })

    await test.step('Click Continue and set a length', async () => {
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'arguments',
        currentArgKey: 'length',
        currentArgValue: '5',
        headerArguments: {
          Profiles: '1 profile',
          Length: '5',
        },
        highlightedHeaderArg: 'length',
        commandName: 'Extrude',
      })
      await page.waitForTimeout(timeout)
      await page.keyboard.type('1')
    })

    await test.step('Click Continue, see no more error, and click Submit', async () => {
      await cmdBar.progressCmdBar()
      await cmdBar.expectState({
        stage: 'review',
        headerArguments: {
          Profiles: '1 profile',
          Length: '1',
        },
        commandName: 'Extrude',
      })
      await page.waitForTimeout(timeout)
      await cmdBar.submit()
    })

    await test.step('Expect extrude in feature tree and code', async () => {
      await scene.settled(cmdBar)
      await editor.expectEditor.toContain('extrude(')
      await expect(
        await toolbar.getFeatureTreeOperation('extrude001', 0)
      ).toBeVisible()
      await page.waitForTimeout(timeout * 10)
    })
  })
})
