import { test, expect } from '@playwright/test'
import {
  doExport,
  getUtils,
  Paths,
  setupElectron,
  tearDown,
} from './test-utils'
import fsp from 'fs/promises'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'When machine-api server not found button is disabled',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(`${dir}/bracket`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/focusrite_scarlett_mounting_braket.kcl',
          `${dir}/bracket/main.kcl`
        )
      },
    })

    await page.setViewportSize({ width: 1200, height: 500 })
    const u = await getUtils(page)

    await expect(page.getByText('bracket')).toBeVisible()

    await page.getByText('bracket').click()

    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    const notFoundText = 'Machine API server not found'
    await expect(page.getByText(notFoundText)).not.toBeVisible()

    // Find the make button
    const makeButton = page.getByRole('button', { name: 'Make' })
    // Make sure the button is visible but disabled
    await expect(makeButton).toBeVisible()
    await expect(makeButton).toBeDisabled()

    // When you hover over the button, the tooltip should show
    // that the machine-api server is not found
    await makeButton.hover()
    await expect(page.getByText(notFoundText)).toBeVisible()

    await electronApp.close()
  }
)
