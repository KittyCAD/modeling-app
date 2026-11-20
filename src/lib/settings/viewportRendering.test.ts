import { expect, it } from 'vitest'
import { getSceneOverlayTheme } from '@src/lib/settings/viewportRendering'
import { Themes } from '@src/lib/theme'

it.each([
  {
    theme: Themes.Light,
    mode: 'default',
    local: false,
    foreground: Themes.Dark,
  },
  {
    theme: Themes.Dark,
    mode: 'default',
    local: false,
    foreground: Themes.Light,
  },
  {
    theme: Themes.Light,
    mode: 'retrocad',
    local: false,
    foreground: Themes.Light,
  },
  {
    theme: Themes.Light,
    mode: 'phosphor',
    local: false,
    foreground: Themes.Light,
  },
  {
    theme: Themes.Dark,
    mode: 'retrocad',
    local: false,
    foreground: Themes.Light,
  },
  {
    theme: Themes.Dark,
    mode: 'phosphor',
    local: false,
    foreground: Themes.Light,
  },
  {
    theme: Themes.Light,
    mode: 'default',
    local: true,
    foreground: Themes.Dark,
  },
  {
    theme: Themes.Dark,
    mode: 'default',
    local: true,
    foreground: Themes.Light,
  },
  {
    theme: Themes.Light,
    mode: 'retrocad',
    local: true,
    foreground: Themes.Dark,
  },
  {
    theme: Themes.Light,
    mode: 'phosphor',
    local: true,
    foreground: Themes.Dark,
  },
  {
    theme: Themes.Dark,
    mode: 'retrocad',
    local: true,
    foreground: Themes.Light,
  },
  {
    theme: Themes.Dark,
    mode: 'phosphor',
    local: true,
    foreground: Themes.Light,
  },
] as const)(
  'uses $foreground sketch foreground for $theme / $mode / local=$local',
  ({ theme, mode, local, foreground }) => {
    expect(getSceneOverlayTheme(theme, mode, local)).toBe(foreground)
  }
)
