import type { Locator, Page } from '@playwright/test'
import pixelMatch from 'pixelmatch'
import { PNG } from 'pngjs'

export type TestColor = [number, number, number]

export const TEST_COLORS: { [key: string]: TestColor } = {
  WHITE: [249, 249, 249],
  OFFWHITE: [237, 237, 237],
  GREY: [142, 142, 142],
  YELLOW: [255, 255, 0],
  BLUE: [0, 0, 255],
  DARK_MODE_BKGD: [27, 27, 27],
  DARK_MODE_PLANE_XZ: [50, 50, 99],
} as const

/**
 * We've written a lot of tests using hard-coded pixel coordinates.
 * This function translates those to stream-relative ones,
 * or can be used to get stream coordinates by ratio.
 *
 * This is a duplicate impl to the one in sceneFixture.ts, for use in util functions
 * which predate the fixture-based test system.
 */
export async function convertPagePositionToStream(
  x: number,
  y: number,
  page: Page,
  format: 'pixels' | 'ratio' | undefined = 'pixels'
) {
  const viewportSize = page.viewportSize()
  const streamBoundingBox = await page.getByTestId('stream').boundingBox()
  if (viewportSize === null) {
    throw Error('No viewport')
  }
  if (streamBoundingBox === null) {
    throw Error('No stream to click')
  }

  const resolvedX =
    (x / (format === 'pixels' ? viewportSize.width : 1)) *
      streamBoundingBox.width +
    streamBoundingBox.x
  const resolvedY =
    (y / (format === 'pixels' ? viewportSize.height : 1)) *
      streamBoundingBox.height +
    streamBoundingBox.y

  const resolvedPoint = {
    x: Math.round(resolvedX),
    y: Math.round(resolvedY),
  }

  return resolvedPoint
}

export async function doAndWaitForImageDiff(
  pageOrLocator: Page | Locator,
  fn: () => Promise<unknown>,
  diffCount = 200
) {
  const screenshot1 = PNG.sync.read(
    await pageOrLocator.screenshot({ fullPage: true })
  )
  await fn()

  // Keep screenshots private to this invocation when tests run in parallel.
  // Capture sequentially so slow screenshots do not overlap and starve Electron.
  for (let count = 0; count <= 100; count++) {
    const screenshot2 = PNG.sync.read(
      await pageOrLocator.screenshot({ fullPage: true })
    )
    if (
      screenshot1.width !== screenshot2.width ||
      screenshot1.height !== screenshot2.height ||
      pixelMatch(
        screenshot1.data,
        screenshot2.data,
        null,
        screenshot1.width,
        screenshot1.height
      ) > diffCount
    ) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

export function getPixelRGBs(page: Page) {
  return async (
    coords: { x: number; y: number },
    radius: number
  ): Promise<[number, number, number][]> => {
    const buffer = await page.screenshot({
      fullPage: true,
    })
    const screenshot = PNG.sync.read(buffer)
    const pixMultiplier: number = await page.evaluate('window.devicePixelRatio')
    const allCords: [number, number][] = [[coords.x, coords.y]]
    for (let i = 1; i < radius; i++) {
      allCords.push([coords.x + i, coords.y])
      allCords.push([coords.x - i, coords.y])
      allCords.push([coords.x, coords.y + i])
      allCords.push([coords.x, coords.y - i])
    }
    return allCords.map(([x, y]) => {
      const index =
        (screenshot.width * y * pixMultiplier + x * pixMultiplier) * 4 // rbga is 4 channels
      return [
        screenshot.data[index],
        screenshot.data[index + 1],
        screenshot.data[index + 2],
      ]
    })
  }
}
