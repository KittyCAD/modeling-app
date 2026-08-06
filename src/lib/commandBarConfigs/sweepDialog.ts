export type SweepProfilePosition = 'original' | 'path'
export type SweepProfileOrientation = 'original' | 'perpendicular'

function isEditingSweep(argumentsToSubmit: Record<string, unknown>): boolean {
  return Boolean(argumentsToSubmit.nodeToEdit)
}

export function hasLegacySweepAlignment(
  argumentsToSubmit: Record<string, unknown>
): boolean {
  return (
    argumentsToSubmit.relativeTo === 'SKETCH_PLANE' ||
    argumentsToSubmit.relativeTo === 'TRAJECTORY'
  )
}

export function getSweepProfilePosition(
  argumentsToSubmit: Record<string, unknown>
): SweepProfilePosition | undefined {
  if (hasLegacySweepAlignment(argumentsToSubmit)) {
    return undefined
  }

  if (
    argumentsToSubmit.profilePosition === 'original' ||
    argumentsToSubmit.profilePosition === 'path'
  ) {
    return argumentsToSubmit.profilePosition
  }

  if (typeof argumentsToSubmit.translateProfileToPath === 'boolean') {
    return argumentsToSubmit.translateProfileToPath === true
      ? 'path'
      : 'original'
  }

  return isEditingSweep(argumentsToSubmit) ? undefined : 'original'
}

export function getSweepProfileOrientation(
  argumentsToSubmit: Record<string, unknown>
): SweepProfileOrientation | undefined {
  if (hasLegacySweepAlignment(argumentsToSubmit)) {
    return undefined
  }

  if (
    argumentsToSubmit.profileOrientation === 'original' ||
    argumentsToSubmit.profileOrientation === 'perpendicular'
  ) {
    return argumentsToSubmit.profileOrientation
  }

  if (typeof argumentsToSubmit.orientProfilePerpendicular === 'boolean') {
    return argumentsToSubmit.orientProfilePerpendicular === true
      ? 'perpendicular'
      : 'original'
  }

  return isEditingSweep(argumentsToSubmit) ? undefined : 'original'
}

/**
 * Keep authored alignment behavior intact while translating the dialog's
 * user-facing modes into the independent flags accepted by sweep().
 */
export function normalizeSweepDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const normalized = { ...argumentsToSubmit }

  if (hasLegacySweepAlignment(argumentsToSubmit)) {
    normalized.profilePosition = undefined
    normalized.profileOrientation = undefined
    normalized.translateProfileToPath = undefined
    normalized.orientProfilePerpendicular = undefined
    return normalized
  }

  const profilePosition = getSweepProfilePosition(argumentsToSubmit)
  const profileOrientation = getSweepProfileOrientation(argumentsToSubmit)

  normalized.profilePosition = profilePosition
  normalized.profileOrientation = profileOrientation
  normalized.translateProfileToPath =
    profilePosition === undefined ? undefined : profilePosition === 'path'
  normalized.orientProfilePerpendicular =
    profileOrientation === undefined
      ? undefined
      : profileOrientation === 'perpendicular'

  return normalized
}
