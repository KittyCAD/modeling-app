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

export const sketchingSettings = [faceOnWhenEnteringSketchSetting]
