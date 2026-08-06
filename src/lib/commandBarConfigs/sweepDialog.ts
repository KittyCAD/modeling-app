import { createDialogModeAdapterFor } from '@src/lib/commandBarConfigs/dialogModeAdapter'
import type {
  SweepCommandArgs,
  SweepProfileOrientation,
  SweepProfilePosition,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

export type {
  SweepProfileOrientation,
  SweepProfilePosition,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

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

const createSweepModeAdapter = createDialogModeAdapterFor<SweepCommandArgs>()

const sweepPositionAdapter = createSweepModeAdapter({
  key: 'profilePosition',
  modes: ['original', 'path'] as const,
  infer: (argumentsToSubmit) => {
    if (hasLegacySweepAlignment(argumentsToSubmit)) {
      return undefined
    }
    if (typeof argumentsToSubmit.translateProfileToPath === 'boolean') {
      return argumentsToSubmit.translateProfileToPath ? 'path' : 'original'
    }
    return isEditingSweep(argumentsToSubmit) ? undefined : 'original'
  },
  toRaw: (mode) => ({ translateProfileToPath: mode === 'path' }),
})

const sweepOrientationAdapter = createSweepModeAdapter({
  key: 'profileOrientation',
  modes: ['original', 'perpendicular'] as const,
  infer: (argumentsToSubmit) => {
    if (hasLegacySweepAlignment(argumentsToSubmit)) {
      return undefined
    }
    if (typeof argumentsToSubmit.orientProfilePerpendicular === 'boolean') {
      return argumentsToSubmit.orientProfilePerpendicular
        ? 'perpendicular'
        : 'original'
    }
    return isEditingSweep(argumentsToSubmit) ? undefined : 'original'
  },
  toRaw: (mode) => ({
    orientProfilePerpendicular: mode === 'perpendicular',
  }),
})

export function getSweepProfilePosition(
  argumentsToSubmit: Record<string, unknown>
): SweepProfilePosition | undefined {
  if (hasLegacySweepAlignment(argumentsToSubmit)) {
    return undefined
  }
  return sweepPositionAdapter.get(argumentsToSubmit)
}

export function getSweepProfileOrientation(
  argumentsToSubmit: Record<string, unknown>
): SweepProfileOrientation | undefined {
  if (hasLegacySweepAlignment(argumentsToSubmit)) {
    return undefined
  }
  return sweepOrientationAdapter.get(argumentsToSubmit)
}

/**
 * Keep authored alignment behavior intact while translating the dialog's
 * user-facing modes into the independent flags accepted by sweep().
 */
export function normalizeSweepDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  if (hasLegacySweepAlignment(argumentsToSubmit)) {
    const normalized = { ...argumentsToSubmit }
    normalized.profilePosition = undefined
    normalized.profileOrientation = undefined
    normalized.translateProfileToPath = undefined
    normalized.orientProfilePerpendicular = undefined
    return normalized
  }

  const profilePosition = getSweepProfilePosition(argumentsToSubmit)
  const profileOrientation = getSweepProfileOrientation(argumentsToSubmit)
  const withPosition = sweepPositionAdapter.normalize(
    argumentsToSubmit,
    profilePosition
  )
  const normalized = sweepOrientationAdapter.normalize(
    withPosition,
    profileOrientation
  )
  if (profilePosition === undefined) {
    normalized.translateProfileToPath = undefined
  }
  if (profileOrientation === undefined) {
    normalized.orientProfilePerpendicular = undefined
  }
  return normalized
}
