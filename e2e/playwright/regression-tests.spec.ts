import type { Page } from '@playwright/test'
import { bracket } from '@src/lib/exampleKcl'
import { reportRejection } from '@src/lib/trap'
import * as fsp from 'fs/promises'
import path from 'path'

import { TEST_CODE_TRIGGER_ENGINE_EXPORT_ERROR } from '@e2e/playwright/storageStates'
import type { TestColor } from '@e2e/playwright/test-utils'
import {
  TEST_COLORS,
  executorInputPath,
  getUtils,
  orRunWhenFullSuiteEnabled,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'

test.describe('Regression tests', { tag: ['@skipWin'] }, () => {
  // bugs we found that don't fit neatly into other categories
  test('bad model has inline error #3251', async ({
    context,
    page,
    homePage,
  }) => {
    // because the model has `line([0,0]..` it is valid code, but the model is invalid
    // regression test for https://github.com/KittyCAD/modeling-app/issues/3251
    // Since the bad model also found as issue with the artifact graph, which in tern blocked the editor diognostics
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch2 = startSketchOn("XY")
  sketch001 = startSketchOn("XY")
    |> startProfileAt([-0, -0], %)
    |> line(end = [0, 0])
    |> line(end = [-4.84, -5.29])
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

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
  test('user should not have to press down twice in cmdbar', async ({
    page,
    homePage,
  }) => {
    // because the model has `line([0,0]..` it is valid code, but the model is invalid
    // regression test for https://github.com/KittyCAD/modeling-app/issues/3251
    // Since the bad model also found as issue with the artifact graph, which in tern blocked the editor diognostics
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(XY)
  |> startProfileAt([82.33, 238.21], %)
  |> angledLine([0, 288.63], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       197.97
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %, $rectangleSegmentC001)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude001 = extrude(sketch001, length = 50)
`
      )
    })

    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    await test.step('Check arrow down works', async () => {
      await page.getByTestId('command-bar-open-button').hover()
      await page.getByTestId('command-bar-open-button').click()

      const floppy = page.getByRole('option', {
        name: 'floppy disk arrow Export',
      })

      await floppy.click()

      // press arrow down key twice
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(100)
      await page.keyboard.press('ArrowDown')

      // STL is the third option, which makes sense for two arrow downs
      await expect(page.locator('[data-headlessui-state="active"]')).toHaveText(
        'STL'
      )

      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(200)
    })

    await test.step('Check arrow up works', async () => {
      // theme in test is dark, which is the second option, which means we can test arrow up
      await page.getByTestId('command-bar-open-button').click()

      await page.getByText('The overall appearance of the').click()

      await page.keyboard.press('ArrowUp')
      await page.waitForTimeout(100)

      await expect(page.locator('[data-headlessui-state="active"]')).toHaveText(
        'light'
      )
    })
  })
  test('executes on load', async ({ page, homePage }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `sketch001 = startSketchOn(-XZ)
  |> startProfileAt([-6.95, 4.98], %)
  |> line(end = [25.1, 0.41])
  |> line(end = [0.73, -14.93])
  |> line(end = [-23.44, 0.52])`
      )
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

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

  test('re-executes', async ({ page, homePage }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem('persistCode', `myVar = 5`)
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const variablesTabButton = page.getByTestId('variables-pane-button')
    await variablesTabButton.click()
    // expect to see "myVar:5"
    await expect(
      page.locator('.pretty-json-container >> text=myVar:5')
    ).toBeVisible()

    // change 5 to 67
    await page.locator('#code-mirror-override').getByText('myVar').click()
    await page.keyboard.press('End')
    await page.keyboard.press('Backspace')
    await page.keyboard.type('67')

    await expect(
      page.locator('.pretty-json-container >> text=myVar:67')
    ).toBeVisible()
  })
  test('ProgramMemory can be serialised', async ({ page, homePage }) => {
    const u = await getUtils(page)
    await page.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `part = startSketchOn(XY)
  |> startProfileAt([0, 0], %)
  |> line(end = [0, 1])
  |> line(end = [1, 0])
  |> line(end = [0, -1])
  |> close()
  |> extrude(length = 1)
  |> patternLinear3d(
        axis = [1, 0, 1],
        repetitions = 3,
        distance = 6,
      )`
      )
    })
    await page.setBodyDimensions({ width: 1000, height: 500 })

    const messages: string[] = []

    // Listen for all console events and push the message text to an array
    page.on('console', (message) => messages.push(message.text()))
    await homePage.goToModelingScene()
    await u.waitForPageLoad()

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

  // Not relevant to us anymore, or at least for the time being.
  test.skip('ensure the Zoo logo is not a link in browser app', async ({
    page,
    homePage,
  }) => {
    const u = await getUtils(page)
    await page.setBodyDimensions({ width: 1000, height: 500 })
    await homePage.goToModelingScene()
    await u.waitForPageLoad()

    const zooLogo = page.locator('[data-testid="app-logo"]')
    // Make sure it's not a link
    await expect(zooLogo).not.toHaveAttribute('href')
  })

  test(
    'Position _ Is Out Of Range... regression test',
    { tag: ['@skipWin'] },
    async ({ context, page, homePage }) => {
      const u = await getUtils(page)
      // const PUR = 400 / 37.5 //pixeltoUnitRatio
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await context.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `exampleSketch = startSketchOn("XZ")
      |> startProfileAt([0, 0], %)
      |> angledLine({ angle: 50, length: 45 }, %)
      |> yLine(endAbsolute = 0)
      |> close()
      |>

    example = extrude(exampleSketch, length = 5)
    shell(exampleSketch, faces = ['end'], thickness = 0.25)`
        )
      })

      await expect(async () => {
        await homePage.goToModelingScene()
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
      await expect(page.getByText('Unexpected token: |').first()).toBeVisible()

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
        .toContainText(`exampleSketch = startSketchOn("XZ")
      |> startProfileAt([0, 0], %)
      |> angledLine({ angle: 50, length: 45 }, %)
      |> yLine(endAbsolute = 0)
      |> close()

      thing: "blah"`)

      await expect(page.locator('.cm-lint-marker-error')).toBeVisible()
    }
  )

  test(
    'window resize updates should reconfigure the stream',
    { tag: '@skipLocalEngine' },
    async ({ scene, page, homePage, cmdBar, toolbar }) => {
      await page.addInitScript(
        async ({ code }) => {
          localStorage.setItem(
            'persistCode',
            `@settings(defaultLengthUnit = mm)
sketch002 = startSketchOn(XY)
profile002 = startProfileAt([72.24, -52.05], sketch002)
  |> angledLine([0, 181.26], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001) - 90,
       21.54
     ], %)
  |> angledLine([
       segAng(rectangleSegmentA001),
       -segLen(rectangleSegmentA001)
     ], %)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
extrude002 = extrude(profile002, length = 150)
`
          )
          ;(window as any).playwrightSkipFilePicker = true
        },
        { code: TEST_CODE_TRIGGER_ENGINE_EXPORT_ERROR }
      )

      const websocketPromise = page.waitForEvent('websocket')
      await page.setBodyDimensions({ width: 500, height: 500 })

      await homePage.goToModelingScene()
      const websocket = await websocketPromise

      await scene.connectionEstablished()
      await scene.settled(cmdBar)
      await toolbar.closePane('code')

      // expect pixel color to be background color
      const offModelBefore = { x: 446, y: 250 }
      const onModelBefore = { x: 422, y: 250 }
      const offModelAfter = { x: 692, y: 262 }
      const onModelAfter = { x: 673, y: 266 }

      await scene.expectPixelColor(
        TEST_COLORS.DARK_MODE_BKGD,
        offModelBefore,
        15
      )
      const standardModelGrey: TestColor = [100, 100, 100]
      await scene.expectPixelColor(standardModelGrey, onModelBefore, 15)

      await test.step('resize window and expect "reconfigure_stream" websocket message', async () => {
        // note this is a bit low level for our tests, usually this would go into a fixture
        // but it's pretty unique to this resize test, it can be moved/abstracted if we have further need
        // to listen to websocket messages
        await Promise.all([
          new Promise((resolve) => {
            websocket
              // @ts-ignore
              .waitForEvent('framesent', (frame) => {
                frame.payload
                  .toString()
                  .includes(
                    '"type":"reconfigure_stream","width":1000,"height":500'
                  ) && resolve(true)
              })
              .catch(reportRejection)
          }),
          page.setBodyDimensions({ width: 1000, height: 500 }),
        ])
      })

      await scene.expectPixelColor(
        TEST_COLORS.DARK_MODE_BKGD,
        offModelAfter,
        15
      )
      await scene.expectPixelColor(standardModelGrey, onModelAfter, 15)
    }
  )
  test(
    'when engine fails export we handle the failure and alert the user',
    { tag: '@skipLocalEngine' },
    async ({ scene, page, homePage, cmdBar }) => {
      await page.addInitScript(
        async ({ code }) => {
          localStorage.setItem('persistCode', code)
          ;(window as any).playwrightSkipFilePicker = true
        },
        { code: TEST_CODE_TRIGGER_ENGINE_EXPORT_ERROR }
      )

      await page.setBodyDimensions({ width: 1000, height: 500 })

      await homePage.goToModelingScene()

      await scene.connectionEstablished()
      await scene.settled(cmdBar)

      // export the model
      const exportButton = page.getByTestId('export-pane-button')
      await expect(exportButton).toBeVisible()

      // Click the export button
      await exportButton.click()

      // Click the stl.
      const stlOption = page.getByText('glTF')
      await expect(stlOption).toBeVisible()

      await page.keyboard.press('Enter')

      // Click the checkbox
      const submitButton = page.getByText('Confirm Export')
      await expect(submitButton).toBeVisible()

      await page.keyboard.press('Enter')

      // Find the toast.
      // Look out for the toast message
      const exportingToastMessage = page.getByText(`Exporting...`)

      const engineErrorToastMessage = page.getByText(`Nothing to export`)
      await expect(engineErrorToastMessage).toBeVisible()

      // Make sure the exporting toast is gone
      await expect(exportingToastMessage).not.toBeVisible()

      // Click the code editor
      await page.locator('.cm-content').click()

      await page.waitForTimeout(2000)

      // Expect the toast to be gone
      await expect(engineErrorToastMessage).not.toBeVisible()

      // Now add in code that works.
      await page.locator('.cm-content').fill(bracket)
      await page.keyboard.press('End')
      await page.keyboard.press('Enter')

      await scene.settled(cmdBar)

      // Now try exporting

      // Click the export button
      await exportButton.click()

      // Click the stl.
      await expect(stlOption).toBeVisible()

      await page.keyboard.press('Enter')

      // Click the checkbox
      await expect(submitButton).toBeVisible()

      await page.keyboard.press('Enter')

      // Find the toast.
      // Look out for the toast message
      await expect(exportingToastMessage).toBeVisible()

      // Expect it to succeed.
      await expect(exportingToastMessage).not.toBeVisible({ timeout: 15_000 })
      await expect(engineErrorToastMessage).not.toBeVisible()

      const successToastMessage = page.getByText(`Exported successfully`)
      await expect(successToastMessage).toBeVisible()
    }
  )
  // We updated this test such that you can have multiple exports going at once.
  test(
    'ensure you CAN export while an export is already going',
    { tag: ['@skipLinux', '@skipWin'] },
    async ({ page, homePage }) => {
      const u = await getUtils(page)
      await test.step('Set up the code and durations', async () => {
        await page.addInitScript(
          async ({ code }) => {
            localStorage.setItem('persistCode', code)
            ;(window as any).playwrightSkipFilePicker = true
          },
          {
            code: bracket,
          }
        )

        await page.setBodyDimensions({ width: 1000, height: 500 })

        await homePage.goToModelingScene()
        await u.waitForPageLoad()

        // wait for execution done
        await u.openDebugPanel()
        await u.expectCmdLog('[data-message-type="execution-done"]')
        await u.closeDebugPanel()

        // expect zero errors in guter
        await expect(page.locator('.cm-lint-marker-error')).not.toBeVisible()
      })

      const errorToastMessage = page.getByText(`Error while exporting`)
      const exportingToastMessage = page.getByText(`Exporting...`)
      const engineErrorToastMessage = page.getByText(`Nothing to export`)
      const alreadyExportingToastMessage = page.getByText(`Already exporting`)
      const successToastMessage = page.getByText(`Exported successfully`)

      await test.step('second export', async () => {
        await clickExportButton(page)

        await expect(exportingToastMessage).toBeVisible()

        await clickExportButton(page)

        await test.step('The first export still succeeds', async () => {
          await Promise.all([
            expect(exportingToastMessage).not.toBeVisible({ timeout: 15_000 }),
            expect(errorToastMessage).not.toBeVisible(),
            expect(engineErrorToastMessage).not.toBeVisible(),
            expect(successToastMessage).toBeVisible({ timeout: 15_000 }),
            expect(alreadyExportingToastMessage).not.toBeVisible({
              timeout: 15_000,
            }),
          ])
        })
      })

      await test.step('Successful, unblocked export', async () => {
        // Try exporting again.
        await clickExportButton(page)

        // Find the toast.
        // Look out for the toast message
        await expect(exportingToastMessage).toBeVisible()

        // Expect it to succeed.
        await Promise.all([
          expect(exportingToastMessage).not.toBeVisible(),
          expect(errorToastMessage).not.toBeVisible(),
          expect(engineErrorToastMessage).not.toBeVisible(),
          expect(alreadyExportingToastMessage).not.toBeVisible(),
        ])

        await expect(successToastMessage).toHaveCount(2)
      })
    }
  )

  test(
    `Network health indicator only appears in modeling view`,
    { tag: '@electron' },
    async ({ context, page }, testInfo) => {
      test.fixme(orRunWhenFullSuiteEnabled())
      await context.folderSetupFn(async (dir) => {
        const bracketDir = path.join(dir, 'bracket')
        await fsp.mkdir(bracketDir, { recursive: true })
        await fsp.copyFile(
          executorInputPath('cylinder-inches.kcl'),
          path.join(bracketDir, 'main.kcl')
        )
      })

      await page.setBodyDimensions({ width: 1200, height: 500 })
      const u = await getUtils(page)

      // Locators
      const projectsHeading = page.getByRole('heading', {
        name: 'Your projects',
      })
      const projectLink = page.getByRole('link', { name: 'bracket' })
      const networkHealthIndicator = page.getByTestId('network-toggle')

      await test.step('Check the home page', async () => {
        await expect(projectsHeading).toBeVisible()
        await expect(projectLink).toBeVisible()
        await expect(networkHealthIndicator).not.toBeVisible()
      })

      await test.step('Open the project', async () => {
        await projectLink.click()
      })

      await test.step('Check the modeling view', async () => {
        await expect(networkHealthIndicator).toBeVisible()
        await expect(networkHealthIndicator).toContainText('Problem')
        await u.waitForPageLoad()
        await expect(networkHealthIndicator).toContainText('Connected')
      })
    }
  )

  test(`View gizmo stays visible even when zoomed out all the way`, async ({
    page,
    homePage,
    scene,
  }) => {
    const u = await getUtils(page)

    // Constants and locators
    const planeColor: [number, number, number] = [170, 220, 170]
    const bgColor: [number, number, number] = TEST_COLORS.DARK_MODE_BKGD
    const middlePixelIsColor = async (color: [number, number, number]) => {
      return u.getGreatestPixDiff({ x: 600, y: 250 }, color)
    }
    const gizmo = page.locator('[aria-label*=gizmo]')

    await test.step(`Load an empty file`, async () => {
      await page.addInitScript(async () => {
        localStorage.setItem('persistCode', '@settings(defaultLengthUnit = in)')
      })
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
      await u.waitForPageLoad()
      await u.closeKclCodePanel()
    })

    await test.step(`Zoom out until you can't see the default planes`, async () => {
      await expect
        .poll(async () => middlePixelIsColor(planeColor), {
          timeout: 5000,
          message: 'Plane color is visible',
        })
        .toBeLessThanOrEqual(20)
      await expect(scene.startEditSketchBtn).toBeEnabled()

      let maxZoomOuts = 10
      let middlePixelIsBackgroundColor =
        (await middlePixelIsColor(bgColor)) < 10

      console.time('pressing control')
      await page.keyboard.down('Control')

      while (!middlePixelIsBackgroundColor && maxZoomOuts > 0) {
        await page.waitForTimeout(100)
        await page.mouse.move(650, 460)
        console.time('moved to start point')
        await page.mouse.down({ button: 'right' })
        console.time('moused down')
        await page.mouse.move(650, 50, { steps: 20 })
        console.time('moved to end point')
        await page.waitForTimeout(100)
        await page.mouse.up({ button: 'right' })
        console.time('moused up')
        maxZoomOuts--
        middlePixelIsBackgroundColor = (await middlePixelIsColor(bgColor)) < 15
      }
      await page.keyboard.up('Control')

      expect(middlePixelIsBackgroundColor, {
        message: 'We should not see the default planes',
      }).toBeTruthy()
    })

    await test.step(`Check that the gizmo is still visible`, async () => {
      await expect(gizmo).toBeVisible()
    })
  })

  test(`Refreshing the app doesn't cause the stream to pause on long-executing files`, async ({
    context,
    homePage,
    scene,
    toolbar,
  }) => {
    await context.folderSetupFn(async (dir) => {
      const legoDir = path.join(dir, 'lego')
      await fsp.mkdir(legoDir, { recursive: true })
      await fsp.copyFile(
        executorInputPath('e2e-can-sketch-on-chamfer.kcl'),
        path.join(legoDir, 'main.kcl')
      )
    })

    await test.step(`Test setup`, async () => {
      await homePage.openProject('lego')
      await toolbar.closePane('code')
    })
    await test.step(`Waiting for the loading spinner to disappear`, async () => {
      await scene.loadingIndicator.waitFor({ state: 'detached' })
    })
    await test.step(`The part should start loading quickly, not waiting until execution is complete`, async () => {
      // TODO: use the viewport size to pick the center point, but the `viewport` fixture's values were wrong.
      await scene.expectPixelColor([116, 116, 116], { x: 500, y: 250 }, 15)
    })
  })

  test(`Toolbar doesn't show modeling tools during sketch plane selection animation`, async ({
    page,
    homePage,
    toolbar,
  }) => {
    await test.step('Load an empty file', async () => {
      await page.addInitScript(async () => {
        localStorage.setItem('persistCode', '')
      })
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
    })

    await test.step('Start sketch and select a plane', async () => {
      await toolbar.expectToolbarMode.toBe('modeling')
      // Click the start sketch button
      await toolbar.startSketchPlaneSelection()

      // Click on a default plane at position [700, 200]
      await page.mouse.click(700, 200)

      // Check that the modeling toolbar doesn't appear during the animation
      // The animation typically takes around 500ms, so we'll check for a second
      await toolbar.expectToolbarMode.not.toBe('modeling')

      // After animation completes, we should see the sketching toolbar
      await toolbar.expectToolbarMode.toBe('sketching')
    })
  })

  test(`Delete via feature tree then open code pane, never crash`, async ({
    homePage,
    toolbar,
    editor,
    context,
    page,
    scene,
    cmdBar,
  }) => {
    await context.folderSetupFn(async (dir) => {
      const bracketDir = path.join(dir, 'test-sample')
      await fsp.mkdir(bracketDir, { recursive: true })
      await fsp.writeFile(
        path.join(bracketDir, 'main.kcl'),
        `x = 5
plane001 = offsetPlane(XZ, offset = x)
plane002 = offsetPlane(XZ, offset = -2 * x)`
      )
    })
    await homePage.openProject('test-sample')
    await scene.settled(cmdBar)
    await expect(toolbar.startSketchBtn).toBeEnabled({ timeout: 20_000 })
    const operationButton = await toolbar.getFeatureTreeOperation(
      'Offset Plane',
      1
    )

    await test.step('Delete offset plane via feature tree selection', async () => {
      await expect(operationButton.last()).toBeVisible({ timeout: 10_000 })
      await editor.closePane()
      await operationButton.first().click({ button: 'left' })
      await page.keyboard.press('Delete')
      await scene.settled(cmdBar)
    })

    await test.step(`Open the code pane, don't crash`, async () => {
      await editor.openPane()
      await expect(page.getByText('unexpected error')).not.toBeVisible()
      await editor.expectEditor.toContain(`x = 5`)
      await editor.expectEditor.toContain(`plane001`)
      await editor.expectEditor.not.toContain(`plane002`)
    })
  })

  test.fail(
    'Console errors cause tests to fail',
    async ({ page, homePage }) => {
      const u = await getUtils(page)
      await homePage.goToModelingScene()
      await u.openAndClearDebugPanel()

      await page.getByTestId('custom-cmd-input').fill('foobar')
      await page.getByTestId('custom-cmd-send-button').scrollIntoViewIfNeeded()
      await page.getByTestId('custom-cmd-send-button').click()
    }
  )

  test('scale other than default works with sketch mode', async ({
    page,
    homePage,
    toolbar,
    editor,
    scene,
  }) => {
    await test.step('Load the washer code', async () => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `@settings(defaultLengthUnit = in)

innerDiameter = 0.203
outerDiameter = 0.438
thicknessMax = 0.038
thicknessMin = 0.024
washerSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = outerDiameter / 2)

washer = extrude(washerSketch, length = thicknessMax)`
        )
      })
      await page.setBodyDimensions({ width: 1200, height: 500 })
      await homePage.goToModelingScene()
    })
    const [circleCenterClick] = scene.makeMouseHelpers(650, 300)
    const [circleRadiusClick] = scene.makeMouseHelpers(800, 320)
    const [washerFaceClick] = scene.makeMouseHelpers(657, 286)

    await page.waitForTimeout(100)
    await test.step('Start sketching on the washer face', async () => {
      await toolbar.startSketchPlaneSelection()
      await washerFaceClick()
      await page.waitForTimeout(600) // engine animation
      await toolbar.expectToolbarMode.toBe('sketching')
    })

    await test.step('Draw a circle and verify code', async () => {
      // select circle tool
      await expect
        .poll(async () => {
          await toolbar.circleBtn.click()
          return toolbar.circleBtn.getAttribute('aria-pressed')
        })
        .toBe('true')
      await page.waitForTimeout(100)
      await circleCenterClick()
      // this number will be different if the scale is not set correctly for inches
      await editor.expectEditor.toContain(
        'circle(sketch001, center = [0.06, -0.06]'
      )
      await circleRadiusClick()

      await editor.expectEditor.toContain(
        'circle(sketch001, center = [0.06, -0.06], radius = 0.18'
      )
    })

    await test.step('Exit sketch mode', async () => {
      await toolbar.exitSketch()
      await toolbar.expectToolbarMode.toBe('modeling')

      await toolbar.selectUnit('Yards')
      await editor.expectEditor.toContain('@settings(defaultLengthUnit = yd)')
    })
  })
})

async function clickExportButton(page: Page) {
  await test.step('Running export flow', async () => {
    // export the model
    const exportButton = page.getByTestId('export-pane-button')
    await expect(exportButton).toBeEnabled()

    // Click the export button
    await exportButton.click()

    // Click the gltf.
    const gltfOption = page.getByRole('option', { name: 'glTF' })
    await expect(gltfOption).toBeVisible()

    await page.keyboard.press('Enter')

    // Click the checkbox
    const submitButton = page.getByText('Confirm Export')
    await expect(submitButton).toBeVisible()

    await page.keyboard.press('Enter')
  })
}
