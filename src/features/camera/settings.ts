import type { CameraOrbitType } from '@rust/kcl-lib/bindings/CameraOrbitType'
import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import { optionsSetting } from '@src/contracts/settings'
import type { CameraSystem } from '@src/features/camera/mouseGuards'
import {
  cameraMouseGuards,
  cameraSystems,
} from '@src/features/camera/mouseGuards'

/**
 * The guard table for this machine.
 *
 * The modifier names differ by platform — Option on a Mac is Alt everywhere
 * else — so the descriptions cannot be constants.
 */
const platformGuards = () =>
  cameraMouseGuards(typeof navigator === 'undefined' ? '' : navigator.platform)

/**
 * The camera's own preferences, owned by the sub-feature that acts on them.
 *
 * All three are user-level: `ProjectModelingSettings` in the Rust schema has no
 * camera fields, and rightly so — how someone likes to orbit is a property of
 * the person, not of the part.
 */

export const cameraProjectionSetting = optionsSetting<CameraProjectionType>({
  id: 'modeling.cameraProjection',
  section: 'camera',
  title: 'Projection',
  description:
    'Orthographic keeps parallel edges parallel, which is what you want for drawings. Perspective looks like a photograph.',
  order: 0,
  defaultValue: 'orthographic',
  levels: ['user'],
  toml: ['settings', 'modeling', 'camera_projection'],
  options: [
    { value: 'orthographic', label: 'Orthographic' },
    { value: 'perspective', label: 'Perspective' },
  ],
})

export const cameraOrbitSetting = optionsSetting<CameraOrbitType>({
  id: 'modeling.cameraOrbit',
  section: 'camera',
  title: 'Orbit',
  description:
    'Spherical keeps the model upright, so up stays up. Trackball turns it in whatever direction you drag, which is freer and easier to get lost in.',
  order: 10,
  defaultValue: 'spherical',
  levels: ['user'],
  toml: ['settings', 'modeling', 'camera_orbit'],
  options: [
    { value: 'spherical', label: 'Spherical' },
    { value: 'trackball', label: 'Trackball' },
  ],
})

/**
 * Which package's gestures to use.
 *
 * The detail rows are the point of the setting: "Solidworks" tells you nothing
 * until it tells you that pan is Ctrl and a right drag. The existing app puts
 * the same table under the control, and it is the only way the choice is
 * answerable without trying all seven.
 */
export const cameraControlsSetting = optionsSetting<CameraSystem>({
  id: 'modeling.cameraControls',
  section: 'camera',
  title: 'Controls',
  description: 'Which CAD package’s mouse gestures to use for the 3D view.',
  order: 20,
  defaultValue: 'zoo',
  levels: ['user'],
  // `mouse_controls` in the schema, and snake_case values there — the labels
  // shown here are the names people know the packages by.
  toml: ['settings', 'modeling', 'mouse_controls'],
  options: cameraSystems.map((system) => ({
    value: system,
    label: platformGuards()[system].label,
  })),
  detail: (value) => {
    const guard = platformGuards()[value] ?? platformGuards().zoo
    return [
      { label: 'Rotate', value: guard.rotate.description },
      { label: 'Pan', value: guard.pan.description },
      { label: 'Zoom', value: guard.zoom.description },
    ]
  },
})

export const cameraSettings = [
  cameraProjectionSetting,
  cameraOrbitSetting,
  cameraControlsSetting,
]
