import { booleanSetting } from '@src/contracts/settings'

/**
 * How sketching behaves, owned by the feature that does it.
 *
 * User-level: whether the camera should swing round when you open a sketch is a
 * preference about how somebody likes to work, not a property of the part. The
 * Rust schema has no field for it, and should not.
 */

export const faceOnWhenEnteringSketchSetting = booleanSetting({
  id: 'sketching.faceOnWhenEntering',
  section: 'sketching',
  title: 'Look straight at the sketch plane',
  description:
    'When you open a sketch, turn the camera to face its plane. A plane seen at an angle makes every distance on screen lie about itself, which is why this is on; turn it off if you would rather keep the view you had.',
  order: 0,
  defaultValue: true,
  toml: ['settings', 'sketching', 'face_on_when_entering'],
})

/**
 * Whether every constraint is drawn all the time.
 *
 * Off, because a sketch with thirty constraints in it is a sketch you cannot
 * see: the badges cover the geometry they are about. By default they are revealed
 * by hovering the segment they constrain, which shows the few that are relevant
 * and none of the rest.
 *
 * On is for reading somebody else's sketch, or checking your own is fully
 * constrained — the moments when the constraints *are* what you are looking at.
 */
export const showConstraintsSetting = booleanSetting({
  id: 'sketching.showConstraints',
  section: 'sketching',
  title: 'Show all constraints',
  description:
    'Draw every constraint in an open sketch, rather than revealing them by hovering the segment they belong to. Useful for reading a sketch; noisy while drawing one.',
  order: 1,
  defaultValue: false,
  toml: ['settings', 'sketching', 'show_constraints'],
})

export const sketchingSettings = [
  faceOnWhenEnteringSketchSetting,
  showConstraintsSetting,
]
