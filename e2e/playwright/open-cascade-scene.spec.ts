import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'
import {
  PLAYWRIGHT_LAYOUT_SETTINGS,
  settingsToToml,
} from '@e2e/playwright/test-utils'
import { TEST_SETTINGS, TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'
import { IS_PLAYWRIGHT_KEY, TOKEN_PERSIST_KEY } from '@src/lib/constants'
import { OPEN_CASCADE_CIRCLE_EXTRUDE_KCL } from '@src/network/openCascadeProofFixture'

test(
  'renders the OpenCascade circle extrusion scene',
  { tag: '@snapshot' },
  async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    const tomlStr = settingsToToml({
      settings: {
        ...TEST_SETTINGS,
        ...PLAYWRIGHT_LAYOUT_SETTINGS,
        modeling: {
          engine: 'open_cascade',
        },
        app: {
          ...TEST_SETTINGS.app,
          onboarding_status: 'dismissed',
        },
      },
    })
    await page.addInitScript(
      ({ code, settings }) => {
        localStorage.clear()
        localStorage.setItem(TOKEN_PERSIST_KEY, 'localhost')
        localStorage.setItem(IS_PLAYWRIGHT_KEY, 'true')
        localStorage.setItem('persistCode', code)
        localStorage.setItem(TEST_SETTINGS_KEY, settings)
      },
      { code: OPEN_CASCADE_CIRCLE_EXTRUDE_KCL, settings: tomlStr }
    )
    await page.route('**/user', async (route, request) => {
      if (request.method() !== 'GET') {
        await route.continue()
        return
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'open-cascade-playwright-user',
          name: 'OpenCascade Playwright',
          email: 'open-cascade-playwright@example.com',
          image: '',
        }),
      })
    })
    await page.goto('/')

    const ready = page.getByTestId('open-cascade-scene-ready')
    await expect(ready).toHaveAttribute('data-ready', 'true', {
      timeout: 60_000,
    })

    const pixelStats = await readCanvasPixelStats(page)
    expect(pixelStats.nonBlankPixels).toBeGreaterThan(500)

    await expect(page.getByTestId('open-cascade-scene')).toHaveScreenshot(
      'open-cascade-circle-extrude.png',
      { maxDiffPixels: 500 }
    )
  }
)

async function readCanvasPixelStats(page: Page) {
  return page.getByTestId('open-cascade-scene-canvas').evaluate((canvas) => {
    const c = canvas as HTMLCanvasElement
    const gl =
      c.getContext('webgl2', { preserveDrawingBuffer: true }) ||
      c.getContext('webgl', { preserveDrawingBuffer: true })
    if (!gl) {
      return { nonBlankPixels: 0, width: c.width, height: c.height }
    }

    const width = c.width
    const height = c.height
    const pixels = new Uint8Array(width * height * 4)
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    let nonBlankPixels = 0
    for (let index = 0; index < pixels.length; index += 4) {
      const r = pixels[index]
      const g = pixels[index + 1]
      const b = pixels[index + 2]
      const a = pixels[index + 3]
      if (
        a > 0 &&
        (Math.abs(r - 245) > 8 ||
          Math.abs(g - 247) > 8 ||
          Math.abs(b - 250) > 8)
      ) {
        nonBlankPixels += 1
      }
    }

    return { nonBlankPixels, width, height }
  })
}
