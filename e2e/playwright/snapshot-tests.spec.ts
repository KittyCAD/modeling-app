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

const TEST_OVERLAY_TIMEOUT_MS = 1_500 // slightly longer than OVERLAY_TIMEOUT_MS in @src/components/ModelingMachineProvider

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
  'Draft rectangles should look right',
  { tag: '@snapshot' },
  async ({ page, toolbar, editor }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()

    // Start a sketch
    await u.doAndWaitForImageDiff(
      () => page.getByRole('button', { name: 'Start Sketch' }).click(),
      200
    )

    // Select a plane
    await toolbar.openFeatureTreePane()
    await page.getByRole('button', { name: 'Front plane' }).click()
    await toolbar.closeFeatureTreePane()
    await editor.expectEditor.toContain(`sketch001 = startSketchOn(XZ)`)

    // Equip the rectangle tool
    await page.getByTestId('corner-rectangle').click()

    // Draw the rectangle
    const startPixelX = 600
    const pixelToUnitRatio = 400 / 37.5
    const rectanglePointOne: [number, number] = [
      startPixelX + pixelToUnitRatio * 40,
      500 - pixelToUnitRatio * 30,
    ]
    await page.mouse.move(...rectanglePointOne, { steps: 5 })
    await page.mouse.click(...rectanglePointOne, { delay: 500 })
    await page.mouse.move(
      startPixelX + pixelToUnitRatio * 10,
      500 - pixelToUnitRatio * 10,
      { steps: 5 }
    )
    await page.waitForTimeout(TEST_OVERLAY_TIMEOUT_MS)

    // Ensure the draft rectangle looks the same as it usually does
    await expect(page).toHaveScreenshot({
      maxDiffPixels: 100,
      mask: lowerRightMasks(page),
    })
  }
)

test.describe(
  'Client side scene scale should match engine scale',
  { tag: '@snapshot' },
  () => {
    test('Inch scale', async ({ page, cmdBar, scene, toolbar }) => {
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-5, -5])
  |> xLine(length = 50)
  |> tangentialArc(end = [50, 50])
`
        )
      })
      const u = await getUtils(page)
      await u.waitForAuthSkipAppStart()
      await scene.settled(cmdBar)

      await toolbar.editSketch(0)

      // screen shot should show the sketch
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: lowerRightMasks(page),
      })

      // exit sketch
      await u.doAndWaitForImageDiff(() => toolbar.exitSketch(), 200)

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
      await page.addInitScript(async () => {
        localStorage.setItem(
          'persistCode',
          `sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-5, -5])
  |> xLine(length = 50)
  |> tangentialArc(end = [50, 50])
`
        )
      })
      const u = await getUtils(page)
      await u.waitForAuthSkipAppStart()
      await scene.settled(cmdBar)

      await toolbar.editSketch(0)

      // screen shot should show the sketch
      await expect(page).toHaveScreenshot({
        maxDiffPixels: 100,
        mask: lowerRightMasks(page),
      })

      // exit sketch
      await u.doAndWaitForImageDiff(() => toolbar.exitSketch(), 200)

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
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

sweepSketch = startSketchOn(XY)
  |> startProfile(at = [2, 0])
  |> arc(angleStart = 0, angleEnd = 360deg, radius = 2)
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
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

sweepSketch = startSketchOn(XY)
  |> startProfile(at = [2, 0])
  |> arc(angleStart = 0, angleEnd = 360deg, radius = 2)
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
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

sweepSketch = startSketchOn(XY)
  |> startProfile(at = [2, 0])
  |> arc(angleStart = 0, angleEnd = 360deg, radius = 2)
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
