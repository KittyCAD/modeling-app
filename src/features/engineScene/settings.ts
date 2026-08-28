import type { CameraProjectionType } from '@rust/kcl-lib/bindings/CameraProjectionType'
import { booleanSetting, optionsSetting } from '@src/contracts/settings'

/**
 * The modelling settings, owned by the feature that acts on them.
 *
 * Exported as handles rather than read through a string key, so a consumer gets
 * the value's type from the declaration and a rename is a compile error. KCL
 * execution imports two of these: the same preference reaches the engine as a
 * command and the executor as a config field, and there is only one place it is
 * declared.
 *
 * The TOML paths match `rust/kcl-lib/src/settings/types`, which is what makes
 * the files this app writes the files that schema describes. Which levels each
 * one allows also comes from there: `ProjectModelingSettings` has no camera
 * fields, so offering a per-project camera override would write a key nothing
 * reads.
 */

export const cameraProjectionSetting = optionsSetting<CameraProjectionType>({
  id: 'modeling.cameraProjection',
  section: 'modeling',
  title: 'Camera projection',
  description:
    'Orthographic keeps parallel edges parallel, which is what you want for drawings. Perspective looks like a photograph.',
  order: 0,
  defaultValue: 'orthographic',
  // No per-project meaning: this is how someone prefers to see geometry, not a
  // property of the geometry.
  levels: ['user'],
  toml: ['settings', 'modeling', 'camera_projection'],
  options: [
    { value: 'orthographic', label: 'Orthographic' },
    { value: 'perspective', label: 'Perspective' },
  ],
})

export const highlightEdgesSetting = booleanSetting({
  id: 'modeling.highlightEdges',
  section: 'modeling',
  title: 'Highlight edges',
  description: 'Draw a line along every edge of a solid.',
  order: 10,
  defaultValue: true,
  toml: ['settings', 'modeling', 'highlight_edges'],
})

export const enableSsaoSetting = booleanSetting({
  id: 'modeling.enableSsao',
  section: 'modeling',
  title: 'Ambient occlusion',
  description:
    'Shade where surfaces meet, which makes shape easier to read. Takes effect the next time the engine connects.',
  order: 20,
  defaultValue: true,
  toml: ['settings', 'modeling', 'enable_ssao'],
})

export const showScaleGridSetting = booleanSetting({
  id: 'modeling.showScaleGrid',
  section: 'modeling',
  title: 'Scale grid',
  description: 'Show a measured grid on the ground plane.',
  order: 30,
  defaultValue: false,
  // The Rust project schema has no field for this, so a project cannot set it.
  levels: ['user'],
  toml: ['settings', 'modeling', 'show_scale_grid'],
})

export const modelingSettings = [
  cameraProjectionSetting,
  highlightEdgesSetting,
  enableSsaoSetting,
  showScaleGridSetting,
]
