import type {
  ApiConstraint,
  ApiObject,
} from '@rust/kcl-lib/bindings/FrontendApi'
import {
  isCircleSegment,
  isConstraint,
  isLineSegment,
  isPointSegment,
} from '@src/machines/sketchSolve/constraints/constraintUtils'
import type { EquipTool } from '@src/machines/sketchSolve/sketchSolveImpl'
import {
  constraintToolConfigs,
  constraintToolNames,
  isDimensionConstraintType,
} from '@src/machines/sketchSolve/tools/constraintToolModel'

export type ToolPickerSelection =
  | { type: 'equip'; tool: EquipTool }
  | { type: 'empty' }
  | { type: 'unsupported' }

export function getToolForConstraintType(
  constraintType: ApiConstraint['type']
): EquipTool | undefined {
  if (isDimensionConstraintType(constraintType)) {
    return 'dimensionTool'
  }

  return constraintToolNames.find((toolName) =>
    constraintToolConfigs[toolName].modes.some(
      (mode) => mode.resultingConstraintType === constraintType
    )
  )
}

export function getToolForApiObject(
  apiObject: ApiObject
): EquipTool | undefined {
  if (isLineSegment(apiObject)) {
    return 'lineTool'
  }

  if (isCircleSegment(apiObject)) {
    return 'circleTool'
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
