import type { HoleBottom, HoleType } from '@src/lang/modifyAst/faces'

function hasHoleDialogValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

export function getHoleType(
  argumentsToSubmit: Record<string, unknown>
): HoleType {
  if (
    argumentsToSubmit.holeType === 'simple' ||
    argumentsToSubmit.holeType === 'counterbore' ||
    argumentsToSubmit.holeType === 'countersink'
  ) {
    return argumentsToSubmit.holeType
  }

  if (
    hasHoleDialogValue(argumentsToSubmit.countersinkAngle) ||
    hasHoleDialogValue(argumentsToSubmit.countersinkDiameter)
  ) {
    return 'countersink'
  }
  if (
    hasHoleDialogValue(argumentsToSubmit.counterboreDepth) ||
    hasHoleDialogValue(argumentsToSubmit.counterboreDiameter)
  ) {
    return 'counterbore'
  }
  return 'simple'
}

export function getHoleBottom(
  argumentsToSubmit: Record<string, unknown>
): HoleBottom {
  if (
    argumentsToSubmit.holeBottom === 'flat' ||
    argumentsToSubmit.holeBottom === 'drill'
  ) {
    return argumentsToSubmit.holeBottom
  }

  return hasHoleDialogValue(argumentsToSubmit.drillPointAngle)
    ? 'drill'
    : 'flat'
}

/**
 * Keep inactive Hole values in the dialog draft while submitting only the
 * dimensions used by the selected head and bottom types.
 */
export function normalizeHoleDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...argumentsToSubmit }
  const holeType = getHoleType(argumentsToSubmit)
  const holeBottom = getHoleBottom(argumentsToSubmit)

  normalized.holeBody = 'blind'
  normalized.holeType = holeType
  normalized.holeBottom = holeBottom

  if (holeType !== 'counterbore') {
    normalized.counterboreDepth = undefined
    normalized.counterboreDiameter = undefined
  }
  if (holeType !== 'countersink') {
    normalized.countersinkAngle = undefined
    normalized.countersinkDiameter = undefined
    normalized.countersinkHeadClearance = undefined
  }
  if (holeBottom !== 'drill') {
    normalized.drillPointAngle = undefined
  }

  return normalized
}
