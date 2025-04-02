// 63.5 is definitely a bit of a magic number, play with it until it looked right
// if it were 64, that would feel like it's something in the engine where a random

import type { OrthographicCamera, Vector3 } from 'three'
import { PerspectiveCamera } from 'three'

// power of 2 is used, but it's the 0.5 seems to make things look much more correct
export const ZOOM_MAGIC_NUMBER = 63.5

export const INTERSECTION_PLANE_LAYER = 1
export const SKETCH_LAYER = 2

// redundant types so that it can be changed temporarily but CI will catch the wrong type
export const DEBUG_SHOW_INTERSECTION_PLANE = false
export const DEBUG_SHOW_BOTH_SCENES = false

export const RAYCASTABLE_PLANE = 'raycastable-plane'

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
export const CIRCLE_3_POINT_DRAFT_POINT = 'circle-3-point-draft-point'
export const CIRCLE_3_POINT_DRAFT_CIRCLE = 'circle-3-point-draft-circle'

export function getSceneScale(
  camera: PerspectiveCamera | OrthographicCamera,
  target: Vector3
): number {
  const distance =
    camera instanceof PerspectiveCamera
      ? camera.position.distanceTo(target)
      : 63.7942123 / camera.zoom

  if (distance <= 20) return 0.1
  else if (distance > 20 && distance <= 200) return 1
  else if (distance > 200 && distance <= 2000) return 10
  else if (distance > 2000 && distance <= 20000) return 100
  else if (distance > 20000) return 1000

  return 1
}
