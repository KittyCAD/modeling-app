/**
 * Area ids, shared so cross-references are not stringly typed at each site.
 *
 * They live apart from the feature module because an area is addressed by
 * things that must not import the area's implementation — a layout preset, a
 * command, another area's empty-state action.
 */
export const EXPLORER_AREA_ID = 'project.files'
/**
 * The code panel: the editor, with the file tree hosted inside it.
 *
 * One area rather than two, because the editor and the tree are one region as
 * far as the dock is concerned — you toggle the code panel, and the tree is a
 * strip within it. The tree is still its own area (see `hostedBy`), so its
 * state, its toggle and its width stay the layout service's business.
 */
export const CODE_AREA_ID = 'project.code'
export const VIEWPORT_AREA_ID = 'project.viewport'
export const INFO_AREA_ID = 'project.info'

/**
 * The width of the file strip inside the code panel.
 *
 * Not a layout node: it is an extent belonging to a region the code area draws
 * itself. Named here so the area and anything that resets it agree on the key.
 */
export const CODE_FILES_EXTENT_ID = 'project.code.files'

/** The default arrangement for a project workspace. */
export const PROJECT_LAYOUT_PRESET = 'project.modeling'
