import { isArray } from '@src/lib/utils'

export type ExtrudeExtentType = 'distance' | 'toFace'
export type ExtrudeDirectionMode = 'oneSide' | 'symmetric' | 'twoSides'

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

export function hasExtrudeDialogValue(value: unknown): boolean {
  return (
    value !== undefined &&
    value !== null &&
    value !== '' &&
    !isSelectionValueEmpty(value)
  )
}

export function getExtrudeExtentType(
  argumentsToSubmit: Record<string, unknown>
): ExtrudeExtentType {
  if (
    argumentsToSubmit.extentType === 'distance' ||
    argumentsToSubmit.extentType === 'toFace'
  ) {
    return argumentsToSubmit.extentType
  }

  return hasExtrudeDialogValue(argumentsToSubmit.to) ? 'toFace' : 'distance'
}

export function getExtrudeDirectionMode(
  argumentsToSubmit: Record<string, unknown>
): ExtrudeDirectionMode {
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
  if (hasExtrudeDialogValue(argumentsToSubmit.bidirectionalLength)) {
    return 'twoSides'
  }
  return 'oneSide'
}

/**
 * Keep inactive Extrude values in the dialog draft while presenting and
 * submitting only the arguments that are valid for the selected modes.
 */
export function normalizeExtrudeDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...argumentsToSubmit }
  const extentType = getExtrudeExtentType(argumentsToSubmit)
  const directionMode =
    extentType === 'toFace'
      ? 'oneSide'
      : getExtrudeDirectionMode(argumentsToSubmit)

  normalized.extentType = extentType
  normalized.directionMode = directionMode

  if (extentType === 'toFace') {
    normalized.length = undefined
    normalized.symmetric = undefined
    normalized.bidirectionalLength = undefined
    normalized.direction = undefined
    normalized.draftAngle = undefined
    normalized.twistAngle = undefined
    normalized.twistAngleStep = undefined
    normalized.twistCenter = undefined
    return normalized
  }

  normalized.to = undefined
  if (directionMode === 'symmetric') {
    normalized.symmetric = true
    normalized.bidirectionalLength = undefined
  } else if (directionMode === 'twoSides') {
    normalized.symmetric = undefined
  } else {
    normalized.symmetric = undefined
    normalized.bidirectionalLength = undefined
  }

  return normalized
}
