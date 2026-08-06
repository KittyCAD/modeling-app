import { createDialogModeAdapterFor } from '@src/lib/commandBarConfigs/dialogModeAdapter'
import type {
  RevolveCommandArgs,
  RevolveAxisMode,
  RevolveDirectionMode,
  RevolveExtentType,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { hasModelingDialogValue } from '@src/lib/commandBarConfigs/modelingDialogShared'

export type {
  RevolveAxisMode,
  RevolveDirectionMode,
  RevolveExtentType,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

export const hasRevolveDialogValue = hasModelingDialogValue

const createRevolveModeAdapter =
  createDialogModeAdapterFor<RevolveCommandArgs>()

const revolveAxisAdapter = createRevolveModeAdapter({
  key: 'axisOrEdge',
  modes: ['Axis', 'Edge'] as const,
  infer: (argumentsToSubmit) =>
    hasModelingDialogValue(argumentsToSubmit.edge) ? 'Edge' : 'Axis',
  toRaw: (mode) =>
    mode === 'Axis' ? { edge: undefined } : { axis: undefined },
})

const revolveExtentAdapter = createRevolveModeAdapter({
  key: 'extentType',
  modes: ['full', 'angle'] as const,
  infer: (argumentsToSubmit) =>
    hasModelingDialogValue(argumentsToSubmit.angle) ? 'angle' : 'full',
})

const revolveDirectionAdapter = createRevolveModeAdapter({
  key: 'directionMode',
  modes: ['oneSide', 'symmetric', 'twoSides'] as const,
  infer: (argumentsToSubmit) => {
    if (argumentsToSubmit.symmetric === true) {
      return 'symmetric'
    }
    return hasModelingDialogValue(argumentsToSubmit.bidirectionalAngle)
      ? 'twoSides'
      : 'oneSide'
  },
  toRaw: (mode) => {
    if (mode === 'symmetric') {
      return { symmetric: true, bidirectionalAngle: undefined }
    }
    if (mode === 'twoSides') {
      return { symmetric: undefined }
    }
    return { symmetric: undefined, bidirectionalAngle: undefined }
  },
})

export function getRevolveAxisMode(
  argumentsToSubmit: Record<string, unknown>
): RevolveAxisMode {
  return revolveAxisAdapter.get(argumentsToSubmit) ?? 'Axis'
}

export function getRevolveExtentType(
  argumentsToSubmit: Record<string, unknown>
): RevolveExtentType {
  return revolveExtentAdapter.get(argumentsToSubmit) ?? 'full'
}

export function getRevolveDirectionMode(
  argumentsToSubmit: Record<string, unknown>
): RevolveDirectionMode {
  return revolveDirectionAdapter.get(argumentsToSubmit) ?? 'oneSide'
}

/**
 * Keep inactive Revolve values in the dialog draft while presenting and
 * submitting only the arguments that are valid for the selected modes.
 */
export function normalizeRevolveDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const axisMode = getRevolveAxisMode(argumentsToSubmit)
  const extentType = getRevolveExtentType(argumentsToSubmit)
  const directionMode =
    extentType === 'full'
      ? 'oneSide'
      : getRevolveDirectionMode(argumentsToSubmit)

  const withAxis = revolveAxisAdapter.normalize(argumentsToSubmit, axisMode)
  const withExtent = revolveExtentAdapter.normalize(withAxis, extentType)
  const normalized = revolveDirectionAdapter.normalize(
    withExtent,
    directionMode
  )

  if (extentType === 'full') {
    normalized.angle = undefined
    normalized.symmetric = undefined
    normalized.bidirectionalAngle = undefined
    return normalized
  }

  return normalized
}
