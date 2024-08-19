import { test, expect } from '@playwright/test'
import {
  doExport,
  getUtils,
  isOutOfViewInScrollContainer,
  Paths,
  setupElectron,
  tearDown,
} from './test-utils'
import fsp from 'fs/promises'
import fs from 'fs'
import { join } from 'path'

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test(
  'when code with error first loads you get errors in console',
  { tag: '@electron' },
  async ({ browserName }, testInfo) => {
    const { electronApp, page } = await setupElectron({
      testInfo,
      folderSetupFn: async (dir) => {
        await fsp.mkdir(`${dir}/broken-code`, { recursive: true })
        await fsp.copyFile(
          'src/wasm-lib/tests/executor/inputs/broken-code-test.kcl',
          `${dir}/broken-code/main.kcl`
        )
      },
    })

    await page.setViewportSize({ width: 1200, height: 500 })
    const u = await getUtils(page)

    await expect(page.getByText('broken-code')).toBeVisible()

    await page.getByText('broken-code').click()

    await expect(page.getByTestId('loading')).toBeAttached()
    await expect(page.getByTestId('loading')).not.toBeAttached({
      timeout: 20_000,
    })

    // error in guter
    await expect(page.locator('.cm-lint-marker-error')).toBeVisible()

    // error text on hover
    await page.hover('.cm-lint-marker-error')
    const crypticErrorText = `Expected a tag declarator`
    await expect(page.getByText(crypticErrorText).first()).toBeVisible()

    await electronApp.close()
  }
)
