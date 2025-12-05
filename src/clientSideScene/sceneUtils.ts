// 63.5 is definitely a bit of a magic number, play with it until it looked right
// if it were 64, that would feel like it's something in the engine where a random

// power of 2 is used, but it's the 0.5 seems to make things look much more correct
export const ZOOM_MAGIC_NUMBER = 63.5

export const INTERSECTION_PLANE_LAYER = 1
export const SKETCH_LAYER = 2

// redundant types so that it can be changed temporarily but CI will catch if left as the wrong type
// eslint-disable-next-line @typescript-eslint/prefer-as-const
export const DEBUG_SHOW_INTERSECTION_PLANE: false = false
// eslint-disable-next-line @typescript-eslint/prefer-as-const
export const DEBUG_SHOW_BOTH_SCENES: false = false

export const RAYCASTABLE_PLANE = 'raycastable-plane'
export const SKETCH_SOLVE_GROUP = 'sketchSolveGroup'

export const X_AXIS = 'xAxis'
export const Y_AXIS = 'yAxis'
/** If a segment angle is less than this many degrees off a meanginful angle it'll snap to it */
export const ANGLE_SNAP_THRESHOLD_DEGREES = 3
/** the THREEjs representation of the group surrounding a "snapped" point that is not yet placed */
export const DRAFT_POINT_GROUP = 'draft-point-group'
/** the THREEjs representation of a "snapped" point that is not yet placed */
export const DRAFT_POINT = 'draft-point'
export const AXIS_GROUP = 'axisGroup'
export const SKETCH_GROUP_SEGMENTS = 'sketch-group-segments'
export const ARROWHEAD = 'arrowhead'
export const SEGMENT_LENGTH_LABEL = 'segment-length-label'
export const SEGMENT_LENGTH_LABEL_TEXT = 'segment-length-label-text'
export const SEGMENT_LENGTH_LABEL_OFFSET_PX = 30
export const SKETCH_POINT_HANDLE = 'sketch-point-handle'
