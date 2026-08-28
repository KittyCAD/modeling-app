import { optionsSetting } from '@src/contracts/settings'
import type { ThemeSetting } from '@src/contracts/theme'

/**
 * The colour theme, as a setting.
 *
 * User level only. A theme follows the person, not the drawing — and the Rust
 * project schema has no field for it, so a per-project override would write a
 * key nothing reads.
 */
export const themeSetting = optionsSetting<ThemeSetting>({
  id: 'appearance.theme',
  section: 'appearance',
  title: 'Theme',
  description: 'Dark, light, or whatever this computer is set to.',
  order: 0,
  defaultValue: 'system',
  levels: ['user'],
  toml: ['settings', 'app', 'appearance', 'theme'],
  options: [
    { value: 'system', label: 'Match system' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
  ],
})
