import { isArray } from '@src/lib/utils'

export type RevolveExtentType = 'full' | 'angle'
export type RevolveDirectionMode = 'oneSide' | 'symmetric' | 'twoSides'
export type RevolveAxisMode = 'Axis' | 'Edge'

function isSelectionValueEmpty(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false
  }

  const selection = value as {
    graphSelections?: unknown[]
    otherSelections?: unknown[]
  }
  if (
    !isArray(selection.graphSelections) ||
    !isArray(selection.otherSelections)
  ) {
    return false
  }

  return (
    selection.graphSelections.length === 0 &&
    selection.otherSelections.length === 0
  )
}

export function hasRevolveDialogValue(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== '' &&
    !isSelectionValueEmpty(value)
  )
}

export function getRevolveAxisMode(
  argumentsToSubmit: Record<string, unknown>
): RevolveAxisMode {
  if (
    argumentsToSubmit.axisOrEdge === 'Axis' ||
    argumentsToSubmit.axisOrEdge === 'Edge'
  ) {
    return argumentsToSubmit.axisOrEdge
  }

  return hasRevolveDialogValue(argumentsToSubmit.edge) ? 'Edge' : 'Axis'
}

export function getRevolveExtentType(
  argumentsToSubmit: Record<string, unknown>
): RevolveExtentType {
  if (
    argumentsToSubmit.extentType === 'full' ||
    argumentsToSubmit.extentType === 'angle'
  ) {
    return argumentsToSubmit.extentType
  }

  return hasRevolveDialogValue(argumentsToSubmit.angle) ? 'angle' : 'full'
}

export function getRevolveDirectionMode(
  argumentsToSubmit: Record<string, unknown>
): RevolveDirectionMode {
  if (
    argumentsToSubmit.directionMode === 'oneSide' ||
    argumentsToSubmit.directionMode === 'symmetric' ||
    argumentsToSubmit.directionMode === 'twoSides'
  ) {
    return argumentsToSubmit.directionMode
  }
  if (argumentsToSubmit.symmetric === true) {
    return 'symmetric'
  }
  if (hasRevolveDialogValue(argumentsToSubmit.bidirectionalAngle)) {
    return 'twoSides'
  }
  return 'oneSide'
}

/**
 * Keep inactive Revolve values in the dialog draft while presenting and
 * submitting only the arguments that are valid for the selected modes.
 */
export function normalizeRevolveDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...argumentsToSubmit }
  const axisMode = getRevolveAxisMode(argumentsToSubmit)
  const extentType = getRevolveExtentType(argumentsToSubmit)
  const directionMode =
    extentType === 'full'
      ? 'oneSide'
      : getRevolveDirectionMode(argumentsToSubmit)

  normalized.axisOrEdge = axisMode
  normalized.extentType = extentType
  normalized.directionMode = directionMode

  if (axisMode === 'Axis') {
    normalized.edge = undefined
  } else {
    normalized.axis = undefined
  }

  if (extentType === 'full') {
    normalized.angle = undefined
    normalized.symmetric = undefined
    normalized.bidirectionalAngle = undefined
    return normalized
  }

  if (directionMode === 'symmetric') {
    normalized.symmetric = true
    normalized.bidirectionalAngle = undefined
  } else if (directionMode === 'twoSides') {
    normalized.symmetric = undefined
  } else {
    normalized.symmetric = undefined
    normalized.bidirectionalAngle = undefined
  }

  return normalized
}
