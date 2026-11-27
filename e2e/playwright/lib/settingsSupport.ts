import * as TOML from '@iarna/toml'
import type { Page } from '@playwright/test'
import { expect } from '@playwright/test'
import type { ProjectConfiguration } from '@rust/kcl-lib/bindings/ProjectConfiguration'
import type { Configuration } from '@src/lang/wasm'
import type { DeepPartial } from '@src/lib/types'
import { parse as parseToml } from 'smol-toml'

type SettingsTomlConfiguration = {
  settings?: Record<string, unknown>
}

export function settingsToToml(settings: SettingsTomlConfiguration) {
  // eslint-disable-next-line no-restricted-syntax
  return TOML.stringify(settings as any)
}

export function tomlToSettings(toml: string): DeepPartial<Configuration> {
  // eslint-disable-next-line no-restricted-syntax
  return TOML.parse(toml)
}

export function tomlToPerProjectSettings(
  toml: string
): DeepPartial<ProjectConfiguration> {
  return parseToml(toml)
}

export function perProjectSettingsToToml(
  settings: DeepPartial<ProjectConfiguration>
) {
  // eslint-disable-next-line no-restricted-syntax
  return TOML.stringify(settings as any)
}

export async function openSettingsExpectText(page: Page, text: string) {
  const settings = page.getByTestId('settings-dialog-panel')
  await expect(settings).toBeVisible()
  // You are viewing the user tab
  const actualText = settings.getByText(text)
  await expect(actualText).toBeVisible()
}

export async function openSettingsExpectLocator(page: Page, selector: string) {
  const settings = page.getByTestId('settings-dialog-panel')
  await expect(settings).toBeVisible()
  // You are viewing the keybindings tab
  const settingsLocator = settings.locator(selector)
  await expect(settingsLocator).toBeVisible()
}

export async function expectKeybindingsSettingsVisible(page: Page) {
  const settings = page.getByTestId('settings-dialog-panel')
  await expect(settings).toBeVisible()
  await expect(
    settings.getByRole('button', { name: 'Add keybinding' })
  ).toBeVisible()
  await expect(
    settings.getByRole('columnheader', { name: 'Title' })
  ).toBeVisible()
  await expect(
    settings.getByRole('columnheader', { name: 'Keystrokes' })
  ).toBeVisible()
}
