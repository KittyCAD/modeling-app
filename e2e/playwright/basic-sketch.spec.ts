import type { Page } from '@playwright/test'

import type { HomePageFixture } from '@e2e/playwright/fixtures/homePageFixture'
import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import type { EditorFixture } from '@e2e/playwright/fixtures/editorFixture'
import {
  PERSIST_MODELING_CONTEXT,
  TEST_COLORS,
  commonPoints,
  getUtils,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.setTimeout(120000)

async function doBasicSketch(
  page: Page,
  openPanes: string[],
  fixtures: {
    homePage: HomePageFixture
    cmdBar: CmdBarFixture
    scene: SceneFixture
    editor: EditorFixture
  }
) {
  const { cmdBar, scene, homePage, editor } = fixtures
  const u = await getUtils(page)
  await page.setBodyDimensions({ width: 1200, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio

  await homePage.goToModelingScene()
  await scene.settled(cmdBar)
  await u.waitForPageLoad()
  await page.waitForTimeout(1000)
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
    await expect(u.codeLocator).toHaveText(`sketch001 = startSketchOn(XZ)`)
  }
  await u.closeDebugPanel()

  // wait for line button to have aria-pressed as proxy for sketch mode
  await expect
    .poll(async () => page.getByTestId('line').getAttribute('aria-pressed'), {
      timeout: 10_000,
    })
    .toBe('true')
  await page.waitForTimeout(200)

  const startXPx = 600
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  if (openPanes.includes('code')) {
    await expect(u.codeLocator).toContainText(
      `sketch001 = startSketchOn(XZ)profile001 = startProfile(sketch001, at = ${commonPoints.startAt})`
    )
  }
  await page.waitForTimeout(500)
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
  await page.waitForTimeout(500)

  if (openPanes.includes('code')) {
    await expect(
      u.codeLocator
    ).toHaveText(`sketch001 = startSketchOn(XZ)profile001 = startProfile(sketch001, at = ${commonPoints.startAt})
  |> xLine(length = ${commonPoints.num1})`)
  }
  await page.waitForTimeout(500)
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  if (openPanes.includes('code')) {
    await expect(
      u.codeLocator
    ).toHaveText(`sketch001 = startSketchOn(XZ)profile001 = startProfile(sketch001, at = ${
      commonPoints.startAt
    })
  |> xLine(length = ${commonPoints.num1})
  |> yLine(length = ${commonPoints.num1 + 0.01})`)
  } else {
    await page.waitForTimeout(500)
  }
  await page.waitForTimeout(200)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  if (openPanes.includes('code')) {
    await expect(
      u.codeLocator
    ).toHaveText(`@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)profile001 = startProfile(sketch001, ${
      commonPoints.startAt
    })
  |> xLine(length = ${commonPoints.num1})
  |> yLine(length = ${commonPoints.num1 + 0.01})
  |> xLine(length = ${commonPoints.num2 * -1})`)
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
    expect(await u.getGreatestPixDiff(line1, TEST_COLORS.BLUE)).toBeLessThan(3)
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

  await page.getByRole('button', { name: 'constraints: open menu' }).click()
  await page.getByRole('button', { name: 'Equal Length' }).click()

  // Open the code pane.
  await u.openKclCodePanel()
  await editor.expectEditor.toContain(
    `@settings(defaultLengthUnit = in)sketch001 = startSketchOn(XZ)profile001 = startProfile(sketch001, at = ${
      commonPoints.startAt
    })
  |> xLine(length = ${commonPoints.num1}, tag = $seg01)
  |> yLine(length = ${commonPoints.num1 + 0.01})
  |> xLine(length = -segLen(seg01))`,
    { shouldNormalise: true }
  )
}

test.describe('Basic sketch', () => {
  test('code pane open at start', async ({
    page,
    homePage,
    cmdBar,
    scene,
    editor,
  }) => {
    await doBasicSketch(page, ['code'], { cmdBar, scene, homePage, editor })
  })

  test('code pane closed at start', async ({
    page,
    homePage,
    cmdBar,
    scene,
    editor,
  }) => {
    // Load the app with the code panes
    await page.addInitScript(async (persistModelingContext) => {
      localStorage.setItem(
        persistModelingContext,
        JSON.stringify({ openPanes: [] })
      )
    }, PERSIST_MODELING_CONTEXT)
    await doBasicSketch(page, [], { cmdBar, scene, homePage, editor })
  })
})
