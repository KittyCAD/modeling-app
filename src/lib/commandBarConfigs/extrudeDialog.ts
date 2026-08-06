import { createDialogModeAdapterFor } from '@src/lib/commandBarConfigs/dialogModeAdapter'
import type {
  ExtrudeCommandArgs,
  ExtrudeDirectionMode,
  ExtrudeExtentType,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'
import { hasModelingDialogValue } from '@src/lib/commandBarConfigs/modelingDialogShared'

export type {
  ExtrudeDirectionMode,
  ExtrudeExtentType,
} from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

export const hasExtrudeDialogValue = hasModelingDialogValue

const createExtrudeModeAdapter =
  createDialogModeAdapterFor<ExtrudeCommandArgs>()

const extrudeExtentAdapter = createExtrudeModeAdapter({
  key: 'extentType',
  modes: ['distance', 'toFace'] as const,
  infer: (argumentsToSubmit) =>
    hasModelingDialogValue(argumentsToSubmit.to) ? 'toFace' : 'distance',
})

const extrudeDirectionAdapter = createExtrudeModeAdapter({
  key: 'directionMode',
  modes: ['oneSide', 'symmetric', 'twoSides'] as const,
  infer: (argumentsToSubmit) => {
    if (argumentsToSubmit.symmetric === true) {
      return 'symmetric'
    }
    return hasModelingDialogValue(argumentsToSubmit.bidirectionalLength)
      ? 'twoSides'
      : 'oneSide'
  },
  toRaw: (mode) => {
    if (mode === 'symmetric') {
      return { symmetric: true, bidirectionalLength: undefined }
    }
    if (mode === 'twoSides') {
      return { symmetric: undefined }
    }
    return { symmetric: undefined, bidirectionalLength: undefined }
  },
})

export function getExtrudeExtentType(
  argumentsToSubmit: Record<string, unknown>
): ExtrudeExtentType {
  return extrudeExtentAdapter.get(argumentsToSubmit) ?? 'distance'
}

export function getExtrudeDirectionMode(
  argumentsToSubmit: Record<string, unknown>
): ExtrudeDirectionMode {
  return extrudeDirectionAdapter.get(argumentsToSubmit) ?? 'oneSide'
}

/**
 * Keep inactive Extrude values in the dialog draft while presenting and
 * submitting only the arguments that are valid for the selected modes.
 */
export function normalizeExtrudeDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const extentType = getExtrudeExtentType(argumentsToSubmit)
  const directionMode =
    extentType === 'toFace'
      ? 'oneSide'
      : getExtrudeDirectionMode(argumentsToSubmit)
  const withExtent = extrudeExtentAdapter.normalize(
    argumentsToSubmit,
    extentType
  )
  const normalized = extrudeDirectionAdapter.normalize(
    withExtent,
    directionMode
  )

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
  return normalized
}
