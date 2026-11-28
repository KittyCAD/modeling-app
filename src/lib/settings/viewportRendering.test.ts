import { expect, it } from 'vitest'
import { getSceneOverlayTheme } from '@src/lib/settings/viewportRendering'
import { Themes } from '@src/lib/theme'

it.each([
  { theme: Themes.Light, mode: 'default', foreground: Themes.Dark },
  { theme: Themes.Dark, mode: 'default', foreground: Themes.Light },
  { theme: Themes.Light, mode: 'retrocad', foreground: Themes.Light },
  { theme: Themes.Light, mode: 'phosphor', foreground: Themes.Light },
  { theme: Themes.Dark, mode: 'retrocad', foreground: Themes.Light },
  { theme: Themes.Dark, mode: 'phosphor', foreground: Themes.Light },
] as const)(
  'uses $foreground sketch foreground for $theme / $mode',
  ({ theme, mode, foreground }) => {
    expect(getSceneOverlayTheme(theme, mode)).toBe(foreground)
  }
)
