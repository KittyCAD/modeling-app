import { expect, test } from './zoo-test'

/* eslint-disable jest/no-conditional-expect */

/**
 * Snapshot Tests for Text-to-CAD API Requests
 *
 * These tests are primarily designed to capture the requests sent to the Text-to-CAD API
 * rather than to verify application behavior. Unlike regular tests, these tests:
 *
 * 1. Don't assert much about the application's response or state changes
 * 2. Focus on setting up specific scenarios and triggering API requests
 * 3. Use the captureTextToCadRequestSnapshot() method to save request payloads to snapshot files
 *
 * The main purpose is to maintain a collection of real-world API request examples that can be:
 * - Used for regression testing the (AI) API
 * - Referenced when making changes to the Text-to-CAD integration, particularly the meta-prompts
 *   the frontend adds to the user's prompt
 *
 * These tests intentionally don't wait for or verify responses, as we're primarily
 * interested in capturing the outgoing requests for documentation and analysis.
 *
 */

const file = `sketch001 = startSketchOn(XZ)
profile001 = startProfileAt([57.81, 250.51], sketch001)
  |> line(end = [121.13, 56.63], tag = $seg02)
  |> line(end = [83.37, -34.61], tag = $seg01)
  |> line(end = [19.66, -116.4])
  |> line(end = [-221.8, -41.69])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(profile001, length = 200)
sketch002 = startSketchOn(XZ)
  |> startProfileAt([-73.64, -42.89], %)
  |> xLine(length = 173.71)
  |> line(end = [-22.12, -94.4])
  |> xLine(length = -156.98)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(sketch002, length = 50)
sketch003 = startSketchOn(XY)
  |> startProfileAt([52.92, 157.81], %)
  |> angledLine([0, 176.4], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       53.4
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %, $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude003 = extrude(sketch003, length = 20)
`
test.describe('edit with AI example snapshots', () => {
  test(
    `change colour`,
    { tag: '@snapshot' },
    async ({ context, homePage, cmdBar, editor, page, scene }) => {
      await context.addInitScript((file) => {
        localStorage.setItem('persistCode', file)
      }, file)
      await homePage.goToModelingScene()
      await scene.waitForExecutionDone()

      const body1CapCoords = { x: 571, y: 351 }
      const [clickBody1Cap] = scene.makeMouseHelpers(
        body1CapCoords.x,
        body1CapCoords.y
      )
      const yellow: [number, number, number] = [179, 179, 131]
      const submittingToast = page.getByText('Submitting to Text-to-CAD API...')

      await test.step('wait for scene to load select body and check selection came through', async () => {
        await scene.expectPixelColor([134, 134, 134], body1CapCoords, 15)
        await clickBody1Cap()
        await scene.expectPixelColor(yellow, body1CapCoords, 20)
        await editor.expectState({
          highlightedCode: '',
          activeLines: ['|>startProfileAt([-73.64,-42.89],%)'],
          diagnostics: [],
        })
      })

      await test.step('fire off edit prompt', async () => {
        await cmdBar.captureTextToCadRequestSnapshot(test.info())
        await cmdBar.openCmdBar('promptToEdit')
        // being specific about the color with a hex means asserting pixel color is more stable
        await page
          .getByTestId('cmd-bar-arg-value')
          .fill('make this neon green please, use #39FF14')
        await page.waitForTimeout(100)
        await cmdBar.progressCmdBar()
        await expect(submittingToast).toBeVisible()
      })
    }
  )
})
