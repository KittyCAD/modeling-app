import { expect } from '@playwright/test'
import { getUtils, setup, tearDown } from './test-utils'
import { SaveSettingsPayload } from 'lib/settings/settingsTypes'
import { TEST_SETTINGS_KEY, TEST_SETTINGS_CORRUPTED } from './storageStates'
import * as TOML from '@iarna/toml'
import { test } from './lib/base-fixture'

test.beforeEach(async ({ context, page }) => {
  await setup(context, page)
})

test.afterEach(async ({ page }, testInfo) => {
  await tearDown(page, testInfo)
})

test.describe('Testing settings', () => {
  test('Stored settings are validated and fall back to defaults', async ({
    page,
  }) => {
    const u = await getUtils(page)

    // Override beforeEach test setup
    // with corrupted settings
    await page.addInitScript(
      async ({ settingsKey, settings }) => {
        localStorage.setItem(settingsKey, settings)
      },
      {
        settingsKey: TEST_SETTINGS_KEY,
        settings: TOML.stringify({ settings: TEST_SETTINGS_CORRUPTED }),
      }
    )

    await page.setViewportSize({ width: 1200, height: 500 })

    await u.waitForAuthSkipAppStart()

    // Check the settings were reset
    const storedSettings = TOML.parse(
      await page.evaluate(
        ({ settingsKey }) => localStorage.getItem(settingsKey) || '',
        { settingsKey: TEST_SETTINGS_KEY }
      )
    ) as { settings: SaveSettingsPayload }

    expect(storedSettings.settings?.app?.theme).toBe(undefined)

    // Check that the invalid settings were removed
    expect(storedSettings.settings?.modeling?.defaultUnit).toBe(undefined)
    expect(storedSettings.settings?.modeling?.mouseControls).toBe(undefined)
    expect(storedSettings.settings?.app?.projectDirectory).toBe(undefined)
    expect(storedSettings.settings?.projects?.defaultProjectName).toBe(
      undefined
    )
  })

  test('Project settings can be set and override user settings', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    // Open the settings modal with the browser keyboard shortcut
    await page.keyboard.press('Meta+Shift+,')

    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible()
    await page
      .locator('select[name="app-theme"]')
      .selectOption({ value: 'light' })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set theme to "light" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)

    // Check that the user setting was not changed
    await page.getByRole('radio', { name: 'User' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('dark')

    // Roll back to default "system" theme
    await page
      .getByText(
        'themeRoll back themeRoll back to match defaultThe overall appearance of the appl'
      )
      .hover()
    await page
      .getByRole('button', {
        name: 'Roll back theme',
      })
      .click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Check that the project setting did not change
    await page.getByRole('radio', { name: 'Project' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')
  })

  test('Project settings can be opened with keybinding from the editor', async ({
    page,
  }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    // Put the cursor in the editor
    await page.locator('.cm-content').click()

    // Open the settings modal with the browser keyboard shortcut
    await page.keyboard.press('Meta+Shift+,')

    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible()
    await page
      .locator('select[name="app-theme"]')
      .selectOption({ value: 'light' })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set theme to "light" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)

    // Check that the user setting was not changed
    await page.getByRole('radio', { name: 'User' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('dark')

    // Roll back to default "system" theme
    await page
      .getByText(
        'themeRoll back themeRoll back to match defaultThe overall appearance of the appl'
      )
      .hover()
    await page
      .getByRole('button', {
        name: 'Roll back theme',
      })
      .click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Check that the project setting did not change
    await page.getByRole('radio', { name: 'Project' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')
  })

  test('Project and user settings can be reset', async ({ page }) => {
    const u = await getUtils(page)
    await page.setViewportSize({ width: 1200, height: 500 })
    await u.waitForAuthSkipAppStart()
    await page
      .getByRole('button', { name: 'Start Sketch' })
      .waitFor({ state: 'visible' })

    // Put the cursor in the editor
    await page.locator('.cm-content').click()

    // Open the settings modal with the browser keyboard shortcut
    await page.keyboard.press('Meta+Shift+,')

    await expect(
      page.getByRole('heading', { name: 'Settings', exact: true })
    ).toBeVisible()

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()

    await page
      .locator('select[name="app-theme"]')
      .selectOption({ value: 'light' })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set theme to "light" for this project`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')

    // Check that the user setting was not changed
    await page.getByRole('radio', { name: 'User' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()

    // Verify it is now set to the default value
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Set the user theme to light.
    await page
      .locator('select[name="app-theme"]')
      .selectOption({ value: 'light' })

    // Verify the toast appeared
    await expect(
      page.getByText(`Set theme to "light" as a user default`)
    ).toBeVisible()
    // Check that the theme changed
    await expect(page.locator('body')).not.toHaveClass(`body-bg dark`)
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')

    await page.getByRole('radio', { name: 'Project' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('light')

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()
    // Verify it is now set to the default value
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    await page.getByRole('radio', { name: 'User' }).click()
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')

    // Click the reset settings button.
    await page.getByRole('button', { name: 'Restore default settings' }).click()

    // Verify it is now set to the default value
    await expect(page.locator('select[name="app-theme"]')).toHaveValue('system')
  })
})
