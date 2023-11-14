import { test, expect } from '@playwright/test'
import { secrets } from './secrets'

test.beforeEach(async ({ page, context }) => {
  context.addInitScript(async (token) => {
    localStorage.setItem('TOKEN_PERSIST_KEY', token)
    localStorage.setItem('persistCode', ``)
    localStorage.setItem(
      'SETTINGS_PERSIST_KEY',
      JSON.stringify({
        baseUnit: 'in',
        cameraControls: 'KittyCAD',
        defaultDirectory: '',
        defaultProjectName: 'project-$nnn',
        onboardingStatus: 'dismissed',
        showDebugPanel: false,
        textWrapping: 'On',
        theme: 'system',
        unitSystem: 'imperial',
      })
    )
  }, secrets.token)
})

test.setTimeout(60000)

test('Basic sketch', async ({ page }) => {
  page.setViewportSize({ width: 1000, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.goto('localhost:3000')

  // wait for 'Loading KittyCAD Modeling App...' spinner
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="initial-load"]')
  )
  // wait for 'Loading stream...' spinner
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="loading-stream"]')
  )
  await page.waitForTimeout(2000)
  // const pageContent = await page.content()
  // Log the HTML content
  // console.log(pageContent)

  // wait for all spinners to be gone
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="loading"]')
  )

  await page.waitForFunction(() =>
    document.querySelector('[data-testid="start-sketch"]')
  )

  await expect(page.getByRole('button', { name: 'Start Sketch' })).toBeVisible()

  // wait 2 seconds
  await page.waitForTimeout(1000)

  // click on "Start Sketch" button
  await page.click('text=Start Sketch')
  await page.waitForTimeout(1000)

  // click at location (x=700, y=400)
  await page.mouse.click(700, 200)

  // wait for button with text "Line"
  await expect(page.getByRole('button', { name: 'Line' })).toBeVisible()
  await page.click('text=Line')

  const startXPx = 600
  await page.waitForTimeout(600)
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
  await page.waitForTimeout(600)
  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)

  const startAt = '[19.31, -13.41]'
  const tenish = '10.03'
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${tenish}, 0], %)`)

  await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${tenish}, 0], %)
  |> line([0, ${tenish}], %)`)
  await page.mouse.click(startXPx, 500 - PUR * 20)
  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line([${tenish}, 0], %)
  |> line([0, ${tenish}], %)
  |> line([-19.97, 0], %)`)

  // deselect line tool
  await page.click('text=Line')
  await page.waitForTimeout(100)

  // click between first two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 15, 500 - PUR * 10)
  await page.waitForTimeout(400)

  // hold down shift
  await page.keyboard.down('Shift')
  await page.waitForTimeout(100)
  // click between the latest two clicks to get center of the line
  await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 20)
  await page.waitForTimeout(300)

  // selected two lines therefore there should be two cursors
  await expect(page.locator('.cm-cursor')).toHaveCount(2)

  await page.click('text=Equal Length')

  await expect(page.locator('.cm-content'))
    .toHaveText(`const part001 = startSketchOn('-XZ')
  |> startProfileAt(${startAt}, %)
  |> line({ to: [10.03, 0], tag: 'seg01' }, %)
  |> line([0, ${tenish}], %)
  |> angledLine([180, segLen('seg01', %)], %)`)

  // await page.waitForTimeout(4500)
})
