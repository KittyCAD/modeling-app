/**
 * Area ids, shared so cross-references are not stringly typed at each site.
 *
 * They live apart from the feature module because an area is addressed by
 * things that must not import the area's implementation — a layout preset, a
 * command, another area's empty-state action.
 */
export const EXPLORER_AREA_ID = 'project.files'
export const EDITOR_AREA_ID = 'project.editor'
export const VIEWPORT_AREA_ID = 'project.viewport'
export const INFO_AREA_ID = 'project.info'

/** The default arrangement for a project workspace. */
export const PROJECT_LAYOUT_PRESET = 'project.modeling'
