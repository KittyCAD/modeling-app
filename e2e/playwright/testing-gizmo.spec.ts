import { _test, _expect } from './playwright-deprecated'
import { test } from './fixtures/fixtureSetup'
import { getUtils, setup, tearDown } from './test-utils'
import { uuidv4 } from 'lib/utils'
import { TEST_CODE_GIZMO } from './storageStates'

_test.beforeEach(async ({ context, page }, testInfo) => {
  await setup(context, page, testInfo)
})

_test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

_test.describe('Testing Gizmo', () => {
  const cases = [
    {
      testDescription: 'top view',
      clickPosition: { x: 951, y: 347 },
      expectedCameraPosition: { x: 800, y: -152, z: 4886.02 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'bottom view',
      clickPosition: { x: 951, y: 391 },
      expectedCameraPosition: { x: 800, y: -152, z: -4834.02 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'right view',
      clickPosition: { x: 929, y: 379 },
      expectedCameraPosition: { x: 5660.02, y: -152, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'left view',
      clickPosition: { x: 974, y: 359 },
      expectedCameraPosition: { x: -4060.02, y: -152, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'back view',
      clickPosition: { x: 967, y: 383 },
      expectedCameraPosition: { x: 800, y: 4708.02, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
    {
      testDescription: 'front view',
      clickPosition: { x: 935, y: 355 },
      expectedCameraPosition: { x: 800, y: -5012.02, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    },
  ] as const
  for (const {
    clickPosition,
    expectedCameraPosition,
    expectedCameraTarget,
    testDescription,
  } of cases) {
    _test(`check ${testDescription}`, async ({ page, browserName }) => {
      const u = await getUtils(page)
      await page.addInitScript((TEST_CODE_GIZMO) => {
        localStorage.setItem('persistCode', TEST_CODE_GIZMO)
      }, TEST_CODE_GIZMO)
      await page.setViewportSize({ width: 1000, height: 500 })

      await u.waitForAuthSkipAppStart()
      await page.waitForTimeout(100)
      // wait for execution done
      await u.openDebugPanel()
      await u.expectCmdLog('[data-message-type="execution-done"]')
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_look_at',
          vantage: {
            x: 3000,
            y: 3000,
            z: 3000,
          },
          center: {
            x: 800,
            y: -152,
            z: 26,
          },
          up: { x: 0, y: 0, z: 1 },
        },
      })
      await page.waitForTimeout(100)
      await u.clearCommandLogs()
      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      await u.waitForCmdReceive('default_camera_get_settings')

      await u.clearCommandLogs()
      await page.mouse.move(clickPosition.x, clickPosition.y)
      await page.waitForTimeout(100)
      await page.mouse.click(clickPosition.x, clickPosition.y)
      await page.mouse.move(0, 0)
      await u.waitForCmdReceive('default_camera_look_at')
      await u.clearCommandLogs()

      await u.sendCustomCmd({
        type: 'modeling_cmd_req',
        cmd_id: uuidv4(),
        cmd: {
          type: 'default_camera_get_settings',
        },
      })
      await u.waitForCmdReceive('default_camera_get_settings')

      await Promise.all([
        // position
        _expect(page.getByTestId('cam-x-position')).toHaveValue(
          expectedCameraPosition.x.toString()
        ),
        _expect(page.getByTestId('cam-y-position')).toHaveValue(
          expectedCameraPosition.y.toString()
        ),
        _expect(page.getByTestId('cam-z-position')).toHaveValue(
          expectedCameraPosition.z.toString()
        ),
        // target
        _expect(page.getByTestId('cam-x-target')).toHaveValue(
          expectedCameraTarget.x.toString()
        ),
        _expect(page.getByTestId('cam-y-target')).toHaveValue(
          expectedCameraTarget.y.toString()
        ),
        _expect(page.getByTestId('cam-z-target')).toHaveValue(
          expectedCameraTarget.z.toString()
        ),
      ])
    })
  }

  _test('Context menu and popover menu', async ({ page }) => {
    const testCase = {
      testDescription: 'Right view',
      expectedCameraPosition: { x: 5660.02, y: -152, z: 26 },
      expectedCameraTarget: { x: 800, y: -152, z: 26 },
    }

    // Test prelude taken from the above test
    const u = await getUtils(page)
    await page.addInitScript((TEST_CODE_GIZMO) => {
      localStorage.setItem('persistCode', TEST_CODE_GIZMO)
    }, TEST_CODE_GIZMO)
    await page.setViewportSize({ width: 1000, height: 500 })

    await u.waitForAuthSkipAppStart()
    await page.waitForTimeout(100)
    // wait for execution done
    await u.openDebugPanel()
    await u.expectCmdLog('[data-message-type="execution-done"]')
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_look_at',
        vantage: {
          x: 3000,
          y: 3000,
          z: 3000,
        },
        center: {
          x: 800,
          y: -152,
          z: 26,
        },
        up: { x: 0, y: 0, z: 1 },
      },
    })
    await page.waitForTimeout(100)
    await u.clearCommandLogs()
    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await u.waitForCmdReceive('default_camera_get_settings')

    // Now find and select the correct
    // view from the context menu
    await u.clearCommandLogs()
    const gizmo = page.locator('[aria-label*=gizmo]')
    await gizmo.click({ button: 'right' })
    const buttonToTest = page.getByRole('button', {
      name: testCase.testDescription,
    })
    await _expect(buttonToTest).toBeVisible()
    await buttonToTest.click()

    // Now assert we've moved to the correct view
    // Taken from the above test
    await u.waitForCmdReceive('default_camera_look_at')

    await u.sendCustomCmd({
      type: 'modeling_cmd_req',
      cmd_id: uuidv4(),
      cmd: {
        type: 'default_camera_get_settings',
      },
    })
    await u.waitForCmdReceive('default_camera_get_settings')
    await page.waitForTimeout(400)

    await Promise.all([
      // position
      _expect(page.getByTestId('cam-x-position')).toHaveValue(
        testCase.expectedCameraPosition.x.toString()
      ),
      _expect(page.getByTestId('cam-y-position')).toHaveValue(
        testCase.expectedCameraPosition.y.toString()
      ),
      _expect(page.getByTestId('cam-z-position')).toHaveValue(
        testCase.expectedCameraPosition.z.toString()
      ),
      // target
      _expect(page.getByTestId('cam-x-target')).toHaveValue(
        testCase.expectedCameraTarget.x.toString()
      ),
      _expect(page.getByTestId('cam-y-target')).toHaveValue(
        testCase.expectedCameraTarget.y.toString()
      ),
      _expect(page.getByTestId('cam-z-target')).toHaveValue(
        testCase.expectedCameraTarget.z.toString()
      ),
    ])

    // Now test the popover menu.
    // It has the same click handlers, so we can just
    // test that it opens and contains the same content.
    const gizmoPopoverButton = page.getByRole('button', {
      name: 'view settings',
    })
    await _expect(gizmoPopoverButton).toBeVisible()
    await gizmoPopoverButton.click()
    await _expect(buttonToTest).toBeVisible()
  })
})

test.describe(`Testing gizmo, fixture-based`, () => {
  test('Center on selection from menu', async ({
    app,
    cmdBar,
    editor,
    toolbar,
    scene,
  }) => {
    test.skip(
      process.platform === 'win32',
      'Fails on windows in CI, can not be replicated locally on windows.'
    )

    await test.step(`Setup`, async () => {
      const file = await app.getInputFile('test-circle-extrude.kcl')
      await app.initialise(file)
      await scene.expectState({
        camera: {
          position: [4982.21, -23865.37, 13810.64],
          target: [4982.21, 0, 2737.1],
        },
      })
    })
    const [clickCircle, moveToCircle] = scene.makeMouseHelpers(582, 217)

    await test.step(`Select an edge of this circle`, async () => {
      const circleSnippet =
        'circle({ center: [318.33, 168.1], radius: 182.8 }, %)'
      await moveToCircle()
      await clickCircle()
      await editor.expectState({
        activeLines: [circleSnippet.slice(-5)],
        highlightedCode: circleSnippet,
        diagnostics: [],
      })
    })

    await test.step(`Center on selection from menu`, async () => {
      await scene.clickGizmoMenuItem('Center view on selection')
    })

    await test.step(`Verify the camera moved`, async () => {
      await scene.expectState({
        camera: {
          position: [0, -23865.37, 11073.54],
          target: [0, 0, 0],
        },
      })
    })
  })
})
