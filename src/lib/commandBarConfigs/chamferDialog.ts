export type ChamferType = 'equalDistance' | 'twoDistances' | 'distanceAndAngle'

function hasChamferDialogValue(value: unknown): boolean {
  return value !== undefined && value !== null && value !== ''
}

export function getChamferType(
  argumentsToSubmit: Record<string, unknown>
): ChamferType {
  if (
    argumentsToSubmit.chamferType === 'equalDistance' ||
    argumentsToSubmit.chamferType === 'twoDistances' ||
    argumentsToSubmit.chamferType === 'distanceAndAngle'
  ) {
    return argumentsToSubmit.chamferType
  }

  if (hasChamferDialogValue(argumentsToSubmit.angle)) {
    return 'distanceAndAngle'
  }
  if (hasChamferDialogValue(argumentsToSubmit.secondLength)) {
    return 'twoDistances'
  }
  return 'equalDistance'
}

/**
 * Keep inactive Chamfer values in the dialog draft while submitting only the
 * dimensions used by the selected chamfer type.
 */
export function normalizeChamferDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...argumentsToSubmit }
  const chamferType = getChamferType(argumentsToSubmit)

  normalized.chamferType = chamferType

  if (chamferType === 'equalDistance') {
    normalized.secondLength = undefined
    normalized.angle = undefined
  } else if (chamferType === 'twoDistances') {
    normalized.angle = undefined
  } else {
    normalized.secondLength = undefined
  }

  return normalized
}
