import { test, expect } from '@playwright/test'

import { getUtils, setup, tearDown } from './test-utils'

test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Regression tests', () => {
  // bugs we found that don't fit neatly into other categories
  test('bad model has inline error #3251', async ({ page }) => {
    // because the model has `line([0,0]..` it is valid code, but the model is invalid
    // regression test for https://github.com/KittyCAD/modeling-app/issues/3251
    // Since the bad model also found as issue with the artifact graph, which in tern blocked the editor diognostics
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch2 = startSketchOn("XY")
const sketch001 = startSketchAt([-0, -0])
  |> line([0, 0], %)
  |> line([-4.84, -5.29], %)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)`
      )
    })

    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    // this is a cryptic error message, fact that all the lines are co-linear from the `line([0,0])` is the issue why
    // the close doesn't work
    // when https://github.com/KittyCAD/modeling-app/issues/3268 is closed
    // this test will need updating
    const crypticErrorText = `ApiError`
    await expect(page.getByText(crypticErrorText).first()).toBeVisible()
  })
  test('executes on load', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const sketch001 = startSketchOn('-XZ')
    |> startProfileAt([-6.95, 4.98], %)
    |> line([25.1, 0.41], %)
    |> line([0.73, -14.93], %)
    |> line([-23.44, 0.52], %)`
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    // expand variables section
    const variablesTabButton = page.getByTestId('variables-pane-button')
    await variablesTabButton.click()

    // can find sketch001 in the variables summary (pretty-json-container, makes sure we're not looking in the code editor)
    // sketch001 only shows up in the variables summary if it's been executed
    await page.waitForFunction(() => {
      const variablesElement = document.querySelector(
        '.pretty-json-container'
      ) as HTMLDivElement
      return variablesElement.innerHTML.includes('sketch001')
    })
    await expect(
      page.locator('.pretty-json-container >> text=sketch001')
    ).toBeVisible()
  })

  test('re-executes', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', `const myVar = 5`)
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()

    const variablesTabButton = page.getByTestId('variables-pane-button')
    await variablesTabButton.click()
    // expect to see "myVar:5"
    await expect(
      page.locator('.pretty-json-container >> text=myVar:5')
    ).toBeVisible()

    // change 5 to 67
    await page.getByText('const myVar').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('67')

    await expect(
      page.locator('.pretty-json-container >> text=myVar:67')
    ).toBeVisible()
  })
  test('ProgramMemory can be serialised', async ({ page }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const part = startSketchOn('XY')
    |> startProfileAt([0, 0], %)
    |> line([0, 1], %)
    |> line([1, 0], %)
    |> line([0, -1], %)
    |> close(%)
    |> extrude(1, %)
    |> patternLinear3d({
          axis: [1, 0, 1],
          repetitions: 3,
          distance: 6
        }, %)`
      )
    })
    await page.setViewportSize({ width: 1000, height: 500 })

    const messages: string[] = []

    // Listen for all console events and push the message text to an array
    page.on('console', (message) => messages.push(message.text()))
    await u.waitForAuthSkipAppStart()

    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')

    const forbiddenMessages = ['cannot serialize tagged newtype variant']
    forbiddenMessages.forEach((forbiddenMessage) => {
      messages.forEach((message) => {
        expect(message).not.toContain(forbiddenMessage)
      })
    })
  })
  test('ensure the Zoo logo is not a link in browser app', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1000, height: 500 })
    await u.waitForAuthSkipAppStart()

    const zooLogo = page.locator('[data-testid="app-logo"]')
    // Make sure it's not a link
    await expect(zooLogo).not.toHaveAttribute('href')
  })
  test('Position _ Is Out Of Range... regression test', async ({ page }) => {
    const u = await getUtils(page)
    // const PUR = 400 / 37.5 //pixeltoUnitRatio
    await page.setViewportSize({ width: 1200, height: 500 })
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `const exampleSketch = startSketchOn("XZ")
    |> startProfileAt([0, 0], %)
    |> angledLine({ angle: 50, length: 45 }, %)
    |> yLineTo(0, %)
    |> close(%)
    |>
  
  const example = extrude(5, exampleSketch)
  shell({ faces: ['end'], thickness: 0.25 }, exampleSketch)`
      )
    })

    await expect(async () => {
      await page.goto('/')
      await u.waitForPageLoad()
      // error in guter
      await expect(page.locator('.cm-lint-marker-error')).toBeVisible({
        timeout: 1_000,
      })
      await page.waitForTimeout(200)
      // expect it still to be there (sometimes it just clears for a bit?)
      await expect(page.locator('.cm-lint-marker-error')).toBeVisible({
        timeout: 1_000,
      })
    }).toPass({ timeout: 40_000, intervals: [1_000] })

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    await expect(page.getByText('Unexpected token').first()).toBeVisible()

    // Okay execution finished, let's start editing text below the error.
    await u.codeLocator.click()
    // Go to the end of the editor
    // This bug happens when there is a diagnostic in the editor and you try to
    // edit text below it.
    // Or delete a huge chunk of text and then try to edit below it.
    await page.keyboard.press('End')
    await page.keyboard.down('Shift')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('End')
    await page.keyboard.up('Shift')
    await page.keyboard.press('Backspace')
    await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()

    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type('thing: "blah"', { delay: 100 })
    await page.keyboard.press('Enter')
    await page.keyboard.press('ArrowLeft')

    await expect(page.locator('.cm-content'))
      .toContainText(`const exampleSketch = startSketchOn("XZ")
    |> startProfileAt([0, 0], %)
    |> angledLine({ angle: 50, length: 45 }, %)
    |> yLineTo(0, %)
    |> close(%)

    thing: "blah"`)

    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
  })
})
