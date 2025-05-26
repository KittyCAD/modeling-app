import type { CmdBarFixture } from '@e2e/playwright/fixtures/cmdBarFixture'
import type { SceneFixture } from '@e2e/playwright/fixtures/sceneFixture'
import { TEST_SETTINGS, TEST_SETTINGS_KEY } from '@e2e/playwright/storageStates'
import {
  getUtils,
  headerMasks,
  lowerRightMasks,
  settingsToToml,
} from '@e2e/playwright/test-utils'
import { expect, test } from '@e2e/playwright/zoo-test'
import { KCL_DEFAULT_LENGTH } from '@src/lib/constants'

test.beforeEach(async ({ page, context }) => {
  // Make the user avatar image always 404
  // so we see the fallback menu icon for all snapshot tests
  await page.route('https://lh3.googleusercontent.com/**', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'text/plain',
      body: 'Not Found!',
    })
  })
})

// Help engine-manager: tear shit down.
test.afterEach(async ({ page }) => {
  await page.evaluate(() => {
    window.engineCommandManager.tearDown()
  })
})

test.setTimeout(60_000)

const extrudeDefaultPlane = async (
  context: any,
  page: any,
  cmdBar: CmdBarFixture,
  scene: SceneFixture,
  plane: string
) => {
  const code = `part001 = startSketchOn(${plane})
  |> startProfile(at = [7.00, 4.40])
  |> line(end = [6.60, -0.20])
  |> line(end = [2.80, 5.00])
  |> line(end = [-5.60, 4.40])
  |> line(end = [-5.40, -3.80])
  |> close()
  |> extrude(length = 10.00)
`

  // This probably does absolutely nothing based on my trip through here.
  await page.addInitScript(async () => {
    localStorage.setItem(
      'SETTINGS_PERSIST_KEY',
      settingsToToml({
        settings: {
          modeling: {
            base_unit: 'in',
            mouse_controls: 'zoo',
          },
          app: {
            onboarding_status: 'dismissed',
            show_debug_panel: true,
            appearance: {
              theme: 'dark',
            },
          },
          project: {
            default_project_name: 'untitled',
          },
          text_editor: {
            text_wrapping: true,
          },
        },
      })
    )
  })

  await page.addInitScript(async (code: string) => {
    localStorage.setItem('persistCode', code)
  }, code)

  const u = await getUtils(page)
  await page.setViewportSize({ width: 1200, height: 500 })

  await u.waitForAuthSkipAppStart()
  await scene.settled(cmdBar)

  await expect(page).toHaveScreenshot({
    maxDiffPixels: 100,
    mask: lowerRightMasks(page),
  })
  await u.openKclCodePanel()
}

test.describe(
  'extrude on default planes should be stable',
  { tag: '@snapshot' },
  () => {
    test('XY', async ({ page, context, cmdBar, scene }) => {
      await extrudeDefaultPlane(context, page, cmdBar, scene, 'XY')
    })

    test('XZ', async ({ page, context, cmdBar, scene }) => {
      await extrudeDefaultPlane(context, page, cmdBar, scene, 'XZ')
    })

    test('YZ', async ({ page, context, cmdBar, scene }) => {
      await extrudeDefaultPlane(context, page, cmdBar, scene, 'YZ')
    })

    test('-XY', async ({ page, context, cmdBar, scene }) => {
      await extrudeDefaultPlane(context, page, cmdBar, scene, '-XY')
    })

    test('-XZ', async ({ page, context, cmdBar, scene }) => {
      await extrudeDefaultPlane(context, page, cmdBar, scene, '-XZ')
    })

    test('-YZ', async ({ page, context, cmdBar, scene }) => {
      await extrudeDefaultPlane(context, page, cmdBar, scene, '-YZ')
    })
  }
)

test(
  'Draft segments should look right',
  { tag: '@snapshot' },
  async ({ page, scene, toolbar }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    const PUR = 400 / 37.5 //pixeltoUnitRatio
    await u.waitForAuthSkipAppStart()

    const startXPx = 600
    const [endOfTangentClk, endOfTangentMv] = scene.makeMouseHelpers(
      startXPx + PUR * 30,
      500 - PUR * 20,
      { steps: 10 }
    )
    const [threePointArcMidPointClk, threePointArcMidPointMv] =
      scene.makeMouseHelpers(800, 250, { steps: 10 })
    const [threePointArcEndPointClk, threePointArcEndPointMv] =
      scene.makeMouseHelpers(750, 285, { steps: 10 })
    const [arcCenterClk, arcCenterMv] = scene.makeMouseHelpers(750, 210, {
      steps: 10,
    })
    const [arcEndClk, arcEndMv] = scene.makeMouseHelpers(750, 150, {
      steps: 10,
    })

    // click on "Start Sketch" button
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // select a plane
    await page.mouse.click(700, 200)

    let code = `sketch001 = startSketchOn(XZ)`
    await expect(page.locator('.cm-content')).toHaveText(code)

    await page.waitForTimeout(700) // TODO detect animation ending, or disable animation

    await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
    code += `profile001 = startProfile(sketch001, at = [182.59, -246.32])`
    await expect(page.locator('.cm-content')).toHaveText(code)
    await page.waitForTimeout(100)

    await page.mouse.move(startXPx + PUR * 20, 500 - PUR * 10)

    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })

    const lineEndClick = () =>
      page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
    await lineEndClick()
    await page.waitForTimeout(500)

    code += `
  |> xLine(length = 184.3)`
    await expect(page.locator('.cm-content')).toHaveText(code)

    await toolbar.selectTangentialArc()

    // click on the end of the profile to continue it
    await page.waitForTimeout(500)
    await lineEndClick()
    await page.waitForTimeout(500)

    // click to continue profile
    await page.mouse.move(813, 392, { steps: 10 })
    await page.waitForTimeout(500)

    await endOfTangentMv()

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
    await endOfTangentClk()

    await toolbar.selectThreePointArc()
    await page.waitForTimeout(500)
    await endOfTangentClk()
    await threePointArcMidPointMv()
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
    await threePointArcMidPointClk()
    await page.waitForTimeout(100)

    await threePointArcEndPointMv()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })

    await threePointArcEndPointClk()
    await page.waitForTimeout(100)

    await toolbar.selectArc()
    await page.waitForTimeout(100)

    // continue the profile
    await threePointArcEndPointClk()
    await page.waitForTimeout(100)
    await arcCenterMv()
    await page.waitForTimeout(500)
    await arcCenterClk()

    await arcEndMv()
    await page.waitForTimeout(500)
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
    await arcEndClk()
  }
)

test(
  'Draft rectangles should look right',
  { tag: '@snapshot' },
  async ({ page, context, cmdBar, scene }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    const PUR = 400 / 37.5 //pixeltoUnitRatio

    await u.waitForAuthSkipAppStart()

    // click on "Start Sketch" button
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // select a plane
    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)`
    )

    // Wait for camera animation
    await page.waitForTimeout(2000)

    const startXPx = 600

    // Equip the rectangle tool
    await page
      .getByRole('button', { name: 'rectangle Corner rectangle', exact: true })
      .click()

    // Draw the rectangle
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 30)
    await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 10, { steps: 5 })
    await page.waitForTimeout(800)

    // Ensure the draft rectangle looks the same as it usually does
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  }
)
test(
  'Draft circle should look right',
  { tag: '@snapshot' },
  async ({ page, context, cmdBar, scene }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    const PUR = 400 / 37.5 //pixeltoUnitRatio

    await u.waitForAuthSkipAppStart()

    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // select a plane
    await page.mouse.click(700, 200)

    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)`
    )

    // Wait for camera animation
    await page.waitForTimeout(2000)

    const startXPx = 600

    // Equip the rectangle tool
    // await page.getByRole('button', { name: 'line Line', exact: true }).click()
    await page.getByTestId('circle-center').click()

    // Draw the rectangle
    await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 20)
    await page.mouse.move(startXPx + PUR * 10, 500 - PUR * 10, { steps: 5 })

    // Ensure the draft rectangle looks the same as it usually does
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
    await expect(page.locator('.cm-content')).toHaveText(
      `sketch001 = startSketchOn(XZ)profile001 = circle(sketch001, center = [366.89, -62.01], radius = 1)`
    )
  }
)

test.describe(
  'Client side scene scale should match engine scale',
  { tag: '@snapshot' },
  () => {
    test('Inch scale', async ({ page, cmdBar, scene, toolbar }) => {
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      const PUR = 400 / 37.5 //pixeltoUnitRatio

      await u.waitForAuthSkipAppStart()

      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Start Sketch' }).click(),
        200
      )

      // select a plane
      await page.mouse.click(700, 200)

      let code = `sketch001 = startSketchOn(XZ)`
      await expect(page.locator('.cm-content')).toHaveText(code)

      // Wait for camera animation
      await page.waitForTimeout(2000)

      const startXPx = 600
      await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
      code += `profile001 = startProfile(sketch001, at = [182.59, -246.32])`
      await expect(u.codeLocator).toHaveText(code)
      await page.waitForTimeout(100)

      await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
      await page.waitForTimeout(100)

      code += `
  |> xLine(length = 184.3)`
      await expect(u.codeLocator).toHaveText(code)

      await toolbar.selectTangentialArc()
      await page.waitForTimeout(100)

      // click to continue profile
      await page.mouse.click(813, 392)
      await page.waitForTimeout(100)

      await page.mouse.click(startXPx + PUR * 30, 500 - PUR * 20)

      code += `
  |> tangentialArc(endAbsolute = [551.2, -62.01])`
      await expect(u.codeLocator).toHaveText(code)

      // click tangential arc tool again to unequip it
      // it will be available directly in the toolbar since it was last equipped
      await toolbar.tangentialArcBtn.click()
      await page.waitForTimeout(100)

      // screen shot should show the sketch
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: lowerRightMasks(page),
      })

      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Exit Sketch' }).click(),
        200
      )

      await scene.settled(cmdBar)

      // second screen shot should look almost identical, i.e. scale should be the same.
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: lowerRightMasks(page),
      })
    })

    test('Millimeter scale', async ({
      page,
      context,
      cmdBar,
      scene,
      toolbar,
    }) => {
      await context.addInitScript(
        async ({ settingsKey, settings }) => {
          localStorage.setItem(settingsKey, settings)
        },
        {
          settingsKey: TEST_SETTINGS_KEY,
          settings: settingsToToml({
            settings: {
              ...TEST_SETTINGS,
              modeling: {
                ...TEST_SETTINGS.modeling,
                base_unit: 'mm',
              },
            },
          }),
        }
      )
      const u = await getUtils(page)
      await page.setViewportSize({ width: 1200, height: 500 })
      const PUR = 400 / 37.5 //pixeltoUnitRatio

      await u.waitForAuthSkipAppStart()

      await scene.settled(cmdBar)

      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Start Sketch' }).click(),
        200
      )

      // select a plane
      await page.mouse.click(700, 200)

      let code = `sketch001 = startSketchOn(XZ)`
      await expect(u.codeLocator).toHaveText(code)

      // Wait for camera animation
      await page.waitForTimeout(2000)

      const startXPx = 600
      await page.mouse.click(startXPx + PUR * 10, 500 - PUR * 10)
      code += `profile001 = startProfile(sketch001, at = [182.59, -246.32])`
      await expect(u.codeLocator).toHaveText(code)
      await page.waitForTimeout(100)

      await page.mouse.click(startXPx + PUR * 20, 500 - PUR * 10)
      await page.waitForTimeout(100)

      code += `
  |> xLine(length = 184.3)`
      await expect(u.codeLocator).toHaveText(code)

      await toolbar.selectTangentialArc()
      await page.waitForTimeout(100)

      // click to continue profile
      await page.mouse.click(813, 392)
      await page.waitForTimeout(100)

      await page.mouse.click(startXPx + PUR * 30, 500 - PUR * 20)

      code += `
  |> tangentialArc(endAbsolute = [551.2, -62.01])`
      await expect(u.codeLocator).toHaveText(code)

      await toolbar.tangentialArcBtn.click()
      await page.waitForTimeout(100)

      // screen shot should show the sketch
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: lowerRightMasks(page),
      })

      // exit sketch
      await u.doAndWaitForImageDiff(
        () => page.getByRole('button', { name: 'Exit Sketch' }).click(),
        200
      )

      await scene.settled(cmdBar)

      // second screen shot should look almost identical, i.e. scale should be the same.
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: lowerRightMasks(page),
      })
    })
  }
)

test(
  'Sketch on face with none z-up',
  { tag: '@snapshot' },
  async ({ page, context, cmdBar, scene }) => {
    const u = await getUtils(page)
    await context.addInitScript(async (KCL_DEFAULT_LENGTH) => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn(-XZ)
  |> startProfile(at = [1.4, 2.47])
  |> line(end = [9.31, 10.55], tag = $seg01)
  |> line(end = [11.91, -10.42])
  |> close()
  |> extrude(length = ${KCL_DEFAULT_LENGTH})
part002 = startSketchOn(part001, face = seg01)
  |> startProfile(at = [8, 8])
  |> line(end = [4.68, 3.05])
  |> line(end = [0, -7.79])
  |> close()
  |> extrude(length = ${KCL_DEFAULT_LENGTH})
`
      )
    }, KCL_DEFAULT_LENGTH)

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    // Wait for the second extrusion to appear
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    await expect(
      page.getByRole('button', { name: 'Start Sketch' })
    ).not.toBeDisabled()

    await page.getByRole('button', { name: 'Start Sketch' }).click()
    let previousCodeContent = await page.locator('.cm-content').innerText()

    // click at 641, 135
    await page.mouse.click(641, 135)
    await expect(page.locator('.cm-content')).not.toHaveText(
      previousCodeContent
    )
    previousCodeContent = await page.locator('.cm-content').innerText()

    await page.waitForTimeout(300)

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  }
)

test(
  'Zoom to fit on load - solid 2d',
  { tag: '@snapshot' },
  async ({ page, context, cmdBar, scene }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
`
      )
    }, KCL_DEFAULT_LENGTH)

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    // Wait for the second extrusion to appear
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(2000)

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  }
)

test(
  'Zoom to fit on load - solid 3d',
  { tag: '@snapshot' },
  async ({ page, context, cmdBar, scene }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 10)
`
      )
    }, KCL_DEFAULT_LENGTH)

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    // Wait for the second extrusion to appear
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(2000)

    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  }
)

test.describe('Grid visibility', { tag: '@snapshot' }, () => {
  test('Grid turned off to on via command bar', async ({
    page,
    cmdBar,
    scene,
  }) => {
    const u = await getUtils(page)
    const stream = page.getByTestId('stream')

    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    await u.closeKclCodePanel()
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    // Open the command bar.
    await page
      .getByRole('button', { name: 'Commands', exact: false })
      .or(page.getByRole('button', { name: '⌘K' }))
      .click()
    const commandName = 'show scale grid'
    const commandOption = page.getByRole('option', {
      name: commandName,
      exact: false,
    })
    const cmdSearchBar = page.getByPlaceholder('Search commands')
    // This selector changes after we set the setting
    await cmdSearchBar.fill(commandName)
    await expect(commandOption).toBeVisible()
    await commandOption.click()

    const toggleInput = page.getByPlaceholder('Off')
    await expect(toggleInput).toBeVisible()
    await expect(toggleInput).toBeFocused()

    // Select On
    await page.keyboard.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'Off' })).toHaveAttribute(
      'data-headlessui-state',
      'active selected'
    )
    await page.keyboard.press('ArrowUp')
    await expect(page.getByRole('option', { name: 'On' })).toHaveAttribute(
      'data-headlessui-state',
      'active'
    )
    await page.keyboard.press('Enter')

    // Check the toast appeared
    await expect(
      page.getByText(`Set show scale grid to "true" as a user default`)
    ).toBeVisible()

    await expect(stream).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: [...headerMasks(page), ...lowerRightMasks(page)],
    })
  })

  test('Grid turned off', async ({ page, cmdBar, scene }) => {
    const u = await getUtils(page)
    const stream = page.getByTestId('stream')

    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    await u.closeKclCodePanel()
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    await expect(stream).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: [...headerMasks(page), ...lowerRightMasks(page)],
    })
  })

  test('Grid turned on', async ({ page, context, cmdBar, scene }) => {
    await context.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: settingsToToml({
          settings: {
            ...TEST_SETTINGS,
            modeling: {
              ...TEST_SETTINGS.modeling,
              show_scale_grid: true,
            },
          },
        }),
      }
    )

    const u = await getUtils(page)
    const stream = page.getByTestId('stream')

    await page.setViewportSize({ width: 1200, height: 500 })
    await page.goto('/')
    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    await u.closeKclCodePanel()
    // TODO: Find a way to truly know that the objects have finished
    // rendering, because an execution-done message is not sufficient.
    await page.waitForTimeout(1000)

    await expect(stream).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: [...headerMasks(page), ...lowerRightMasks(page)],
    })
  })
})

test('theme persists', async ({ page, context, homePage }) => {
  const u = await getUtils(page)
  await context.addInitScript(async () => {
    localStorage.setItem(
      'persistCode',
      `part001 = startSketchOn(XY)
  |> startProfile(at = [-10, -10])
  |> line(end = [20, 0])
  |> line(end = [0, 20])
  |> line(end = [-20, 0])
  |> close()
  |> extrude(length = 10)
`
    )
  }, KCL_DEFAULT_LENGTH)

  await page.setViewportSize({ width: 1200, height: 500 })

  await homePage.goToModelingScene()
  await page.waitForTimeout(500)

  // await page.getByRole('link', { name: 'Settings Settings (tooltip)' }).click()
  await expect(page.getByTestId('settings-link')).toBeVisible()
  await page.getByTestId('settings-link').click()

  // open user settingns
  await page.getByRole('radio', { name: 'person User' }).click()

  await page.getByTestId('app-theme').selectOption('light')

  await page.getByTestId('settings-close-button').click()

  const networkToggle = page.getByTestId('network-toggle')

  // simulate network down
  await u.emulateNetworkConditions({
    offline: true,
    // values of 0 remove any active throttling. crbug.com/456324#c9
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  // Disconnect and reconnect to check the theme persists through a reload

  // Expect the network to be down
  await expect(networkToggle).toContainText('Problem')

  // simulate network up
  await u.emulateNetworkConditions({
    offline: false,
    // values of 0 remove any active throttling. crbug.com/456324#c9
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })

  await expect(networkToggle).toContainText('Network health (Strong)')

  await expect(page.getByText('building scene')).not.toBeVisible()

  await expect(page, 'expect screenshot to have light theme').toHaveScreenshot({
    maxDiffPixels: 100,
    mask: lowerRightMasks(page),
  })
})

test.describe('code color goober', { tag: '@snapshot' }, () => {
  test('code color goober', async ({ page, context, scene, cmdBar }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `// Create a pipe using a sweep.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90, radius = 5)
  |> line(end = [0, 7])

sweepSketch = startSketchOn(XY)
  |> startProfile(at = [2, 0])
  |> arc(angleStart = 0, angleEnd = 360, radius = 2)
  |> sweep(path = sweepPath)
  |> appearance(
       color = "#bb00ff",
       metalness = 90,
       roughness = 90
     )
`
      )
    })

    await page.setViewportSize({ width: 1200, height: 1000 })
    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    await expect(page, 'expect small color widget').toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  })
  test('code color goober works with single quotes', async ({
    page,
    context,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `// Create a pipe using a sweep.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90, radius = 5)
  |> line(end = [0, 7])

sweepSketch = startSketchOn(XY)
  |> startProfile(at = [2, 0])
  |> arc(angleStart = 0, angleEnd = 360, radius = 2)
  |> sweep(path = sweepPath)
  |> appearance(
       color = '#bb00ff',
       metalness = 90,
       roughness = 90
     )
`
      )
    })

    await page.setViewportSize({ width: 1200, height: 1000 })
    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    await expect(page, 'expect small color widget').toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  })

  test('code color goober opening window', async ({
    page,
    context,
    scene,
    cmdBar,
  }) => {
    const u = await getUtils(page)
    await context.addInitScript(async () => {
      localStorage.setItem(
        'persistCode',
        `// Create a pipe using a sweep.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90, radius = 5)
  |> line(end = [0, 7])

sweepSketch = startSketchOn(XY)
  |> startProfile(at = [2, 0])
  |> arc(angleStart = 0, angleEnd = 360, radius = 2)
  |> sweep(path = sweepPath)
  |> appearance(
       color = "#bb00ff",
       metalness = 90,
       roughness = 90
     )
`
      )
    })

    await page.setViewportSize({ width: 1200, height: 1000 })
    await u.waitForAuthSkipAppStart()

    await scene.settled(cmdBar)

    await expect(page.locator('.cm-css-color-picker-wrapper')).toBeVisible()

    // Click the color widget
    await page.locator('.cm-css-color-picker-wrapper input').click()

    await expect(
      page,
      'expect small color widget to have window open'
    ).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  })
})
