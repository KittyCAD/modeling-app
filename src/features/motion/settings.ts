import { optionsSetting } from '@src/contracts/settings'

/** What the preference can be set to. `system` follows the browser. */
export type LimitAnimationSetting = 'system' | 'on' | 'off'

/**
 * Whether to limit animation, as a setting.
 *
 * Shaped like the theme, and for the same reason: the interesting default is
 * "whatever this computer is set to", and the two explicit values exist for the
 * person whose system preference does not match what they want here. User level
 * only — it follows the person, not the part.
 */
export const limitAnimationSetting = optionsSetting<LimitAnimationSetting>({
  id: 'appearance.limitAnimation',
  section: 'appearance',
  title: 'Limit animation',
  description:
    'Skip the movement and go straight to the result. Follows this computer’s reduced-motion setting unless you choose otherwise.',
  order: 10,
  defaultValue: 'system',
  levels: ['user'],
  toml: ['settings', 'app', 'appearance', 'limit_animation'],
  options: [
    { value: 'system', label: 'Match system' },
    { value: 'on', label: 'Limit animation' },
    { value: 'off', label: 'Allow animation' },
  ],
})

export const motionSettings = [limitAnimationSetting]
