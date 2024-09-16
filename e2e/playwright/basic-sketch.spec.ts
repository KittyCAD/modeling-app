import { test, expect, Page } from '@playwright/test'
import {
  getUtils,
  TEST_COLORS,
  setup,
  tearDown,
  commonPoints,
  PERSIST_MODELING_CONTEXT,
} from './test-utils'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.setTimeout(120000)

async function doBasicSketch(page: Page, openPanes: string[]) {
  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio

  await u.waitForAuthSkipAppStart()
  await u.openDebugPanel()

  // If we have the code pane open, we should see the code.
  if (openPanes.includes('code')) {
    await expect(u.codeLocator).toHaveText(``)
  } else {
    // Ensure we don't see the code.
    await expect(u.codeLocator).not.toBeVisible()
  }

  await expect(
    page.getByRole('button', { name: 'Start Sketch' })
  ).not.toBeDisabled()
  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // click on "Start Sketch" button
  await u.clearCommandLogs()
  await page.getByRole('button', { name: 'Start Sketch' }).click()
  await page.waitForTimeout(100)

  // select a plane
  await page.mouse.click(700, 200)

  if (openPanes.includes('code')) {
    await expect(u.codeLocator).toHaveText(
      `const sketch001 = startSketchOn('XZ')`
    )
  }
  await u.closeDebugPanel()

  await page.waitForTimeout(1000) // TODO detect animation ending, or disable animation

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)`)
  }
  await page.waitForTimeout(500)
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(500)

  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)`)
  }
  await page.waitForTimeout(500)
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1 + 0.01}], %)`)
  } else {
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(200)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  if (openPanes.includes('code')) {
    await expect(u.codeLocator)
      .toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %)
  |> line([0, ${commonPoints.num1 + 0.01}], %)
  |> line([-${commonPoints.num2}, 0], %)`)
  }

  // deselect line tool
  const btnLine = page.getByTestId('line')
  const btnLineAriaPressed = await btnLine.getAttribute('aria-pressed')
  if (btnLineAriaPressed === 'true') {
    await btnLine.click()
  }

  await page.waitForTimeout(100)

  const line1 = await u.getSegmentBodyCoords(`[data-overlay-index="${0}"]`, 0)
  if (openPanes.includes('code')) {
    await expect
      .poll(async () => u.getGreatestPixDiff(line1, TEST_COLORS.WHITE))
      .toBeLessThan(3)
    await page.waitForTimeout(100)
    await expect
      .poll(async () => u.getGreatestPixDiff(line1, [249, 249, 249]))
      .toBeLessThan(3)
    await page.waitForTimeout(100)
  }

  // click between first two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 15, 500 - PUR * 10)
  await page.waitForTimeout(100)

  if (openPanes.includes('code')) {
    await expect(
      await u.getGreatestPixDiff(line1, TEST_COLORS.BLUE)
    ).toBeLessThan(3)
    await expect(await u.getGreatestPixDiff(line1, [0, 0, 255])).toBeLessThan(3)
  }

  // hold down shift
  await page.keyboard.down('Shift')
  await page.waitForTimeout(100)

  // click between the latest two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 20)
  await page.waitForTimeout(100)

  // selected two lines therefore there should be two cursors
  if (openPanes.includes('code')) {
    await expect(page.locator('.cm-cursor')).toHaveCount(2)
    await page.waitForTimeout(100)
  }

  await page.getByRole('button', { name: 'Length: open menu' }).click()
  await page.getByRole('button', { name: 'Equal Length' }).click()

  // Open the code pane.
  await u.openKclCodePanel()
  await expect(u.codeLocator).toHaveText(`const sketch001 = startSketchOn('XZ')
  |> startProfileAt(${commonPoints.startAt}, %)
  |> line([${commonPoints.num1}, 0], %, $seg01)
  |> line([0, ${commonPoints.num1 + 0.01}], %)
  |> angledLine([180, segLen(seg01)], %)`)
}

test.describe('Basic sketch', () => {
  test('code pane open at start', async ({ page }) => {
    // Skip on windows it is being weird.
    test.skip(process.platform === 'win32', 'Skip on windows')
    await doBasicSketch(page, ['code'])
  })

  test('code pane closed at start', async ({ page }) => {
    // Load the app with the code panes
    await page.addInitScript(async (persistModelingContext) => {
      localStorage.setItem(
        persistModelingContext,
        JSON.stringify({ openPanes: [] })
      )
    }, PERSIST_MODELING_CONTEXT)
    await doBasicSketch(page, [])
  })
})
