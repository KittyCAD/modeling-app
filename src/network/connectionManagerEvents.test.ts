import { describe, expect, it, vi } from 'vitest'

import { Themes } from '@src/lib/theme'
import { createOnDarkThemeMediaQueryChange } from '@src/network/connectionManagerEvents'

describe('createOnDarkThemeMediaQueryChange', () => {
  it('ignores system color changes when the app theme is fixed', () => {
    const setTheme = vi
      .fn<(theme: Themes) => Promise<void>>()
      .mockResolvedValue(undefined)

    createOnDarkThemeMediaQueryChange({
      getTheme: () => Themes.Light,
      setTheme,
    })()
    createOnDarkThemeMediaQueryChange({
      getTheme: () => Themes.Dark,
      setTheme,
    })()

    expect(setTheme).not.toHaveBeenCalled()
  })

  it('refreshes the engine theme when the app theme follows the system', () => {
    const setTheme = vi
      .fn<(theme: Themes) => Promise<void>>()
      .mockResolvedValue(undefined)

    createOnDarkThemeMediaQueryChange({
      getTheme: () => Themes.System,
      setTheme,
    })()

    expect(setTheme).toHaveBeenCalledTimes(1)
    expect(setTheme).toHaveBeenCalledWith(Themes.System)
  })
})
