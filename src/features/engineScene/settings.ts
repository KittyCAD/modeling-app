import {
  booleanSetting,
  optionsSetting,
  textSetting,
} from '@src/contracts/settings'

/**
 * How the engine draws the scene, owned by the feature that tells it to.
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
  detail: () => [{ label: 'Applies', value: 'on the next connection' }],
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
  // Like ambient occlusion, chosen when the socket opens.
  detail: () => [{ label: 'Applies', value: 'on the next connection' }],
})

export const backfaceColorSetting = textSetting({
  id: 'modeling.backfaceColor',
  section: 'modeling',
  title: 'Backface colour',
  description:
    'The colour of a surface seen from behind, which is how an inside-out face gives itself away.',
  order: 40,
  defaultValue: '#00D5FF',
  levels: ['user'],
  toml: ['settings', 'modeling', 'backface_color'],
  placeholder: '#00D5FF',
  validate: (value) => /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim()),
})

/** Which orientation gizmo to draw in the corner of the scene. */
export type GizmoType = 'cube' | 'axis'

/**
 * Which gizmo, ported from the existing app's `modeling.gizmoType`.
 *
 * Two, because they are genuinely different tools rather than two styles of one.
 * The cube shows which *face* of the model you are looking at and offers
 * twenty-six places to stand, including edges and corners; the axis version
 * shows the frame and offers six. The cube is the default, as it is upstream.
 *
 * User level: which of the two somebody prefers is about them, not about the
 * part, and the Rust project schema has no field for it.
 */
export const gizmoTypeSetting = optionsSetting<GizmoType>({
  id: 'modeling.gizmoType',
  section: 'modeling',
  title: 'Orientation gizmo',
  description:
    'The cube shows which face of the model you are looking at, and can be turned to an edge or a corner. The axes show the frame.',
  order: 5,
  defaultValue: 'cube',
  levels: ['user'],
  toml: ['settings', 'modeling', 'gizmo_type'],
  options: [
    { value: 'cube', label: 'Cube' },
    { value: 'axis', label: 'Axes' },
  ],
})

export const sceneSettings = [
  highlightEdgesSetting,
  enableSsaoSetting,
  showScaleGridSetting,
  backfaceColorSetting,
  gizmoTypeSetting,
]
