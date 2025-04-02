// Constants shared between sceneEntities.ts and segments.ts
// This file helps break circular dependencies
import type { Group } from 'three'

// Segment types
export const ARC_SEGMENT = 'arc-segment'
export const ARC_SEGMENT_BODY = 'arc-segment-body'
export const ARC_SEGMENT_DASH = 'arc-segment-dash'
export const STRAIGHT_SEGMENT = 'straight-segment'
export const STRAIGHT_SEGMENT_BODY = 'straight-segment-body'
export const STRAIGHT_SEGMENT_DASH = 'straight-segment-body-dashed'
export const STRAIGHT_SEGMENT_SNAP_LINE = 'straight-segment-snap-line'
export const CIRCLE_SEGMENT = 'circle-segment'
export const CIRCLE_SEGMENT_BODY = 'circle-segment-body'
export const CIRCLE_SEGMENT_DASH = 'circle-segment-body-dashed'
export const TANGENTIAL_ARC_TO_SEGMENT = 'tangential-arc-to-segment'
export const TANGENTIAL_ARC_TO_SEGMENT_BODY = 'tangential-arc-to-segment-body'
export const TANGENTIAL_ARC_TO__SEGMENT_DASH =
  'tangential-arc-to-segment-body-dashed'
export const THREE_POINT_ARC_SEGMENT = 'three-point-arc-segment'
export const THREE_POINT_ARC_SEGMENT_BODY = 'three-point-arc-segment-body'
export const THREE_POINT_ARC_SEGMENT_DASH = 'three-point-arc-segment-dash'
export const CIRCLE_THREE_POINT_SEGMENT = 'circle-three-point-segment'
export const CIRCLE_THREE_POINT_SEGMENT_BODY = 'circle-segment-body'
export const CIRCLE_THREE_POINT_SEGMENT_DASH =
  'circle-three-point-segment-body-dashed'

// Handle names
export const ARC_ANGLE_END = 'arc-angle-end'
export const ARC_ANGLE_REFERENCE_LINE = 'arc-angle-reference-line'
export const ARC_CENTER_TO_FROM = 'arc-center-to-from'
export const ARC_CENTER_TO_TO = 'arc-center-to-to'
export const CIRCLE_CENTER_HANDLE = 'circle-center-handle'
export const CIRCLE_THREE_POINT_HANDLE1 = 'circle-three-point-handle1'
export const CIRCLE_THREE_POINT_HANDLE2 = 'circle-three-point-handle2'
export const CIRCLE_THREE_POINT_HANDLE3 = 'circle-three-point-handle3'
export const THREE_POINT_ARC_HANDLE2 = 'three-point-arc-handle2'
export const THREE_POINT_ARC_HANDLE3 = 'three-point-arc-handle3'
export const EXTRA_SEGMENT_HANDLE = 'extraSegmentHandle'
export const PROFILE_START = 'profile-start'

// Additional types
export const DRAFT_DASHED_LINE = 'draft-dashed-line'

// Measurements
export const EXTRA_SEGMENT_OFFSET_PX = 8
export const SEGMENT_WIDTH_PX = 1.6
export const HIDE_SEGMENT_LENGTH = 75
export const HIDE_HOVER_SEGMENT_LENGTH = 60

// Segment groups
export const SEGMENT_BODIES = [
  STRAIGHT_SEGMENT,
  TANGENTIAL_ARC_TO_SEGMENT,
  CIRCLE_SEGMENT,
  CIRCLE_THREE_POINT_SEGMENT,
  ARC_SEGMENT,
  THREE_POINT_ARC_SEGMENT,
]

export const SEGMENT_BODIES_PLUS_PROFILE_START = [
  ...SEGMENT_BODIES,
  PROFILE_START,
]

export const ARC_SEGMENT_TYPES = [
  TANGENTIAL_ARC_TO_SEGMENT,
  THREE_POINT_ARC_SEGMENT,
  ARC_SEGMENT,
]

// Helper functions
export function getParentGroup(
  object: any,
  stopAt: string[] = SEGMENT_BODIES
): Group | null {
  if (stopAt.includes(object?.userData?.type)) {
    return object
  } else if (object?.parent) {
    return getParentGroup(object.parent, stopAt)
  }
  return null
}
