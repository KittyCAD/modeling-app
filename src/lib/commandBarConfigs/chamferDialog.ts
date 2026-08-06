import { createDialogModeAdapterFor } from '@src/lib/commandBarConfigs/dialogModeAdapter'
import type {
  ChamferCommandArgs,
  ChamferType,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { hasModelingDialogValue } from '@src/lib/commandBarConfigs/modelingDialogShared'

export type { ChamferType } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

const chamferTypeAdapter = createDialogModeAdapterFor<ChamferCommandArgs>()({
  key: 'chamferType',
  modes: ['equalDistance', 'twoDistances', 'distanceAndAngle'] as const,
  infer: (argumentsToSubmit) => {
    if (hasModelingDialogValue(argumentsToSubmit.angle)) {
      return 'distanceAndAngle'
    }
    return hasModelingDialogValue(argumentsToSubmit.secondLength)
      ? 'twoDistances'
      : 'equalDistance'
  },
  toRaw: (mode) => {
    if (mode === 'equalDistance') {
      return { secondLength: undefined, angle: undefined }
    }
    return mode === 'twoDistances'
      ? { angle: undefined }
      : { secondLength: undefined }
  },
})

export function getChamferType(
  argumentsToSubmit: Record<string, unknown>
): ChamferType {
  return chamferTypeAdapter.get(argumentsToSubmit) ?? 'equalDistance'
}

/**
 * Keep inactive Chamfer values in the dialog draft while submitting only the
 * dimensions used by the selected chamfer type.
 */
export function normalizeChamferDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const chamferType = getChamferType(argumentsToSubmit)
  return chamferTypeAdapter.normalize(argumentsToSubmit, chamferType)
}
