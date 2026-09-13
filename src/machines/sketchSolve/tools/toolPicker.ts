import type {
  ApiConstraint,
  ApiObject,
  ApiSegment,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  isConstraint,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { EquipTool } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  constraintToolConfigs,
  constraintToolNames,
  isDimensionConstraintType,
  type ConstraintToolName,
} from '@src/machines/sketchSolve/tools/constraintToolModel'

export const toolPickerToolPolicy = {
  // Editing and compound-creation tools have no unique scene entity to pick.
  trimTool: 'not-directly-pickable',
  angledRectTool: 'not-directly-pickable',
  centerRectTool: 'not-directly-pickable',
  cornerRectTool: 'not-directly-pickable',
  dimensionTool: 'pickable',
  pointTool: 'pickable',
  lineTool: 'pickable',
  // Splines are deliberately unsupported by the picker for now.
  splineTool: 'not-directly-pickable',
  centerArcTool: 'pickable',
  circleTool: 'pickable',
  // All arc creation workflows produce an Arc; the picker normalizes to Center Arc.
  tangentialArcTool: 'not-directly-pickable',
  threePointArcTool: 'not-directly-pickable',
  coincidentConstraintTool: 'pickable',
  midpointConstraintTool: 'pickable',
  symmetricConstraintTool: 'pickable',
  tangentConstraintTool: 'pickable',
  parallelConstraintTool: 'pickable',
  equalLengthConstraintTool: 'pickable',
  horizontalConstraintTool: 'pickable',
  verticalConstraintTool: 'pickable',
  perpendicularConstraintTool: 'pickable',
  fixedConstraintTool: 'pickable',
} as const satisfies Record<EquipTool, 'pickable' | 'not-directly-pickable'>

export type DirectlyPickableTool = {
  [Tool in EquipTool]: (typeof toolPickerToolPolicy)[Tool] extends 'pickable'
    ? Tool
    : never
}[EquipTool]

export const segmentToolByType = {
  Point: 'pointTool',
  Line: 'lineTool',
  Arc: 'centerArcTool',
  Circle: 'circleTool',
  ControlPointSpline: null,
} as const satisfies Record<ApiSegment['type'], DirectlyPickableTool | null>

type ConstraintPickerTool = ConstraintToolName | 'dimensionTool'
type MappedTool =
  | Exclude<(typeof segmentToolByType)[ApiSegment['type']], null>
  | ConstraintPickerTool
type Assert<T extends true> = T

export type ToolPickerMappingsAreExhaustive = Assert<
  [
    Exclude<DirectlyPickableTool, MappedTool>,
    Exclude<MappedTool, DirectlyPickableTool>,
  ] extends [never, never]
    ? true
    : false
>

export type ToolPickerSelection =
  | { type: 'equip'; tool: EquipTool }
  | { type: 'empty' }
  | { type: 'unsupported' }

export function getToolForConstraintType(
  constraintType: ApiConstraint['type']
): ConstraintPickerTool | undefined {
  if (isDimensionConstraintType(constraintType)) {
    return 'dimensionTool'
  }

  return constraintToolNames.find((toolName) =>
    constraintToolConfigs[toolName].modes.some(
      (mode) => mode.resultingConstraintType === constraintType
    )
  )
}

function getToolForSegment(
  segment: ApiSegment
): DirectlyPickableTool | undefined {
  if (segment.type === 'Point' && segment.owner !== null) {
    return undefined
  }

  return segmentToolByType[segment.type] ?? undefined
}

export function getToolForApiObject(
  apiObject: ApiObject
): EquipTool | undefined {
  if (apiObject.kind.type === 'Segment') {
    return getToolForSegment(apiObject.kind.segment)
  }

  if (isConstraint(apiObject)) {
    return getToolForConstraintType(apiObject.kind.constraint.type)
  }

  return undefined
}

export function resolveToolPickerSelection(
  candidates: readonly ApiObject[],
  excludedIds: ReadonlySet<number> = new Set()
): ToolPickerSelection {
  let hasEligibleCandidate = false

  for (const candidate of candidates) {
    const isOwnedByExcludedSegment =
      isPointSegment(candidate) &&
      candidate.kind.segment.owner !== null &&
      excludedIds.has(candidate.kind.segment.owner)
    if (excludedIds.has(candidate.id) || isOwnedByExcludedSegment) {
      continue
    }

    hasEligibleCandidate = true
    const tool = getToolForApiObject(candidate)
    if (tool) {
      return { type: 'equip', tool }
    }
  }

  return hasEligibleCandidate ? { type: 'unsupported' } : { type: 'empty' }
}
