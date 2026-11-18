import { SettingsFieldInput } from '@src/components/Settings/SettingsFieldInput'
import { useApp } from '@src/lib/boot'
import { createSettings } from '@src/lib/settings/initialSettings'
import type { Setting } from '@src/lib/settings/Setting'
import { shouldShowSettingInput } from '@src/lib/settings/settingsUtils'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('@src/lib/boot', () => ({ useApp: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('disables Camera Orbit for CATIA and restores the saved choice when switching back', () => {
  const settings = createSettings()
  const { cameraOrbit, mouseControls } = settings.modeling
  cameraOrbit.user = 'trackball'
  vi.mocked(useApp).mockReturnValue({
    settings: { useSettings: () => settings, send: vi.fn() },
  } as unknown as ReturnType<typeof useApp>)
  const input = () => (
    <SettingsFieldInput
      category="modeling"
      settingName="cameraOrbit"
      settingsLevel="user"
      setting={cameraOrbit as Setting<unknown>}
    />
  )
  const { rerender } = render(input())
  expect(screen.getByRole('combobox')).toBeEnabled()
  expect(screen.getByRole('combobox')).toHaveValue('trackball')

  mouseControls.user = 'CATIA'
  rerender(input())
  expect(
    shouldShowSettingInput(cameraOrbit as Setting<unknown>, 'user', settings)
  ).toBe(true)
  expect(screen.getByRole('combobox')).toBeDisabled()
  expect(screen.getByRole('combobox')).toHaveValue('trackball')

  mouseControls.user = 'Zoo'
  rerender(input())
  expect(screen.getByRole('combobox')).toBeEnabled()
  expect(screen.getByRole('combobox')).toHaveValue('trackball')
  expect(cameraOrbit.current).toBe('trackball')
})
