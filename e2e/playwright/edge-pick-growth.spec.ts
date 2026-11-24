import { expect, test } from '@e2e/playwright/base-test'
import { browserTestUtilsPath } from '@e2e/playwright/lib/browserTestUtilsPath'
import type * as EdgePickingScene from '@e2e/playwright/lib/edgePickingScene'

test(
  'picks the nearest visible line within the screen-space radius',
  { tag: ['@web', '@browsers', '@localRenderer'] },
  async ({ page }) => {
    await page.route('**/__edge_picking__', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><body></body>',
      })
    )
    await page.goto('/__edge_picking__')
    const pick = await page.evaluateHandle(async (modulePath) => {
      const { createEdgePickingScene }: typeof EdgePickingScene = await import(
        modulePath
      )
      return createEdgePickingScene()
    }, browserTestUtilsPath)

    // The body edge (x=24) and sketch line (x=32) both run from y=12 to y=44.
    // Both are in reach near x=28, but neither is directly under the cursor.
    const probes: [[number, number], string][] = [
      [[27, 24], 'body edge'],
      [[29, 24], 'sketch line'],
      [[24, 49], 'body edge'], // Five CSS pixels past the endpoint, at DPR 2.
      [[16, 24], 'face'], // Beyond the radius of both lines.
      [[19, 49], 'face'], // Within six pixels on each axis, outside the circular radius.
    ]
    for (const [point, expected] of probes) {
      expect(
        await pick.evaluate((pickAt, point) => pickAt(point), point),
        `pick at (${point.join(', ')})`
      ).toBe(expected)
    }
  }
)
