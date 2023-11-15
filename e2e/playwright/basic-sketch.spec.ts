import { test, expect, Page } from '@playwright/test'
import { secrets } from './secrets'

test.beforeEach(async ({ context }) => {
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

async function waitForPageLoad(page: Page) {
  // wait for 'Loading KittyCAD Modeling App...' spinner
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="initial-load"]')
  )
  // wait for 'Loading stream...' spinner
  await page.waitForFunction(() =>
    document.querySelector('[data-testid="loading-stream"]')
  )
  await page.waitForTimeout(500)

  // wait for all spinners to be gone
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="loading"]')
  )

  await page.waitForFunction(() =>
    document.querySelector('[data-testid="start-sketch"]')
  )
}

test('Basic sketch', async ({ page }) => {
  page.setViewportSize({ width: 1000, height: 500 })
  const PUR = 400 / 37.5 //pixeltoUnitRatio
  await page.goto('localhost:3000')

  await waitForPageLoad(page)

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
})

test('if you write invalid kcl you get inlined errors', async ({ page }) => {
  page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('localhost:3000')

  await waitForPageLoad(page)

  // check no error to begin with
  await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

  /* add the following code to the editor (# error is not a valid line)
    # error
    const topAng = 30
    const bottomAng = 25
   */
  await page.click('.cm-content')
  await page.keyboard.type('# error')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const topAng = 30')
  await page.keyboard.press('Enter')
  await page.keyboard.type('const bottomAng = 25')
  await page.keyboard.press('Enter')

  // error in guter
  await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

  // error text on hover
  await page.hover('.cm-lint-marker-error')
  await expect(page.locator("text=found unknown token '#'")).toBeVisible()

  // select the line that's causing the error and delete it
  await page.click('text=# error')
  await page.keyboard.press('End')
  await page.keyboard.down('Shift')
  await page.keyboard.press('Home')
  await page.keyboard.up('Shift')
  await page.keyboard.press('Backspace')

  // wait for .cm-lint-marker-error not to be visible
  await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
})

test('executes on load', async ({ page, context }) => {
  context.addInitScript(async (token) => {
    localStorage.setItem(
      'persistCode',
      `const part001 = startSketchOn('-XZ')
  |> startProfileAt([-6.95, 4.98], %)
  |> line([25.1, 0.41], %)
  |> line([0.73, -14.93], %)
  |> line([-23.44, 0.52], %)`
    )
  })
  page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('localhost:3000')
  await waitForPageLoad(page)

  // expand variables section
  await page.click('text=Variables')

  // can find part001 in the variables summary (pretty-json-container, makes sure we're not looking in the code editor)
  // part001 only shows up in the variables summary if it's been executed
  await expect(
    page.locator('.pretty-json-container >> text=part001')
  ).toBeVisible()
})

test('re-executes', async ({ page, context }) => {
  context.addInitScript(async (token) => {
    localStorage.setItem('persistCode', `const myVar = 5`)
  })
  page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('localhost:3000')
  await waitForPageLoad(page)

  await page.click('text=Variables')
  // expect to see "myVar:5"
  await expect(
    page.locator('.pretty-json-container >> text=myVar:5')
  ).toBeVisible()

  // change 5 to 67
  await page.click('text=const myVar')
  await page.keyboard.press('End')
  await page.keyboard.press('Backspace')
  await page.keyboard.type('67')

  await expect(
    page.locator('.pretty-json-container >> text=myVar:67')
  ).toBeVisible()
})

test.only('change camera, show planes', async ({ page, context }) => {
  context.addInitScript(async (token) => {
    localStorage.setItem('persistCode', `const myVar = 5`)
  })
  page.setViewportSize({ width: 1000, height: 500 })
  await page.goto('localhost:3000')
  await waitForPageLoad(page)

  // rotate
  await page.mouse.move(700, 200)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(600, 300)
  await page.mouse.up({ button: 'right' })

  await page.waitForTimeout(500)

  // pan
  // await page.keyboard.down('Shift')
  // await page.mouse.move(600, 200)
  // await page.mouse.down({ button: 'right' })
  // await page.mouse.move(700, 200)
  // await page.mouse.up({ button: 'right' })
  // await page.keyboard.up('Shift')

  await page.waitForTimeout(500)

  // zoom
  // await page.keyboard.down('Control')
  // await page.mouse.move(700, 400)
  // await page.mouse.down({ button: 'right' })
  // await page.mouse.move(700, 350)
  // await page.mouse.up({ button: 'right' })
  // await page.keyboard.up('Control')

  await page.waitForTimeout(500)

  await page.waitForTimeout(1000)
  await page.click('text=Start Sketch')
  await page.waitForTimeout(2000)

  // take snapshot
  expect(await page.screenshot()).toMatchSnapshot({
    maxDiffPixels: 100,
    // threshold: 0.6,
  })
})
