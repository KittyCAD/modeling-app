import type { HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
import { createDialogModeAdapterFor } from '@src/lib/commandBarConfigs/dialogModeAdapter'
import { hasModelingDialogValue } from '@src/lib/commandBarConfigs/modelingDialogShared'
import type { HoleCommandArgs } from '@src/lib/commandBarConfigs/modelingCommandStdLibTypes'

const createHoleModeAdapter = createDialogModeAdapterFor<HoleCommandArgs>()

const holeTypeAdapter = createHoleModeAdapter({
  key: 'holeType',
  modes: ['simple', 'counterbore', 'countersink'] as const,
  infer: (argumentsToSubmit) => {
    if (
      hasModelingDialogValue(argumentsToSubmit.countersinkAngle) ||
      hasModelingDialogValue(argumentsToSubmit.countersinkDiameter)
    ) {
      return 'countersink'
    }
    if (
      hasModelingDialogValue(argumentsToSubmit.counterboreDepth) ||
      hasModelingDialogValue(argumentsToSubmit.counterboreDiameter)
    ) {
      return 'counterbore'
    }
    return 'simple'
  },
  toRaw: (mode) => ({
    ...(mode === 'counterbore'
      ? {}
      : {
          counterboreDepth: undefined,
          counterboreDiameter: undefined,
        }),
    ...(mode === 'countersink'
      ? {}
      : {
          countersinkAngle: undefined,
          countersinkDiameter: undefined,
          countersinkHeadClearance: undefined,
        }),
  }),
})

const holeBottomAdapter = createHoleModeAdapter({
  key: 'holeBottom',
  modes: ['flat', 'drill'] as const,
  infer: (argumentsToSubmit) =>
    hasModelingDialogValue(argumentsToSubmit.drillPointAngle)
      ? 'drill'
      : 'flat',
  toRaw: (mode) => (mode === 'flat' ? { drillPointAngle: undefined } : {}),
})

export function getHoleType(
  argumentsToSubmit: Record<string, unknown>
): HoleType {
  return holeTypeAdapter.get(argumentsToSubmit) ?? 'simple'
}

export function getHoleBottom(
  argumentsToSubmit: Record<string, unknown>
): HoleBottom {
  return holeBottomAdapter.get(argumentsToSubmit) ?? 'flat'
}

/**
 * Keep inactive Hole values in the dialog draft while submitting only the
 * dimensions used by the selected head and bottom types.
 */
export function normalizeHoleDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const holeType = getHoleType(argumentsToSubmit)
  const holeBottom = getHoleBottom(argumentsToSubmit)
  const withType = holeTypeAdapter.normalize(argumentsToSubmit, holeType)
  const normalized = holeBottomAdapter.normalize(withType, holeBottom)
  normalized.holeBody = 'blind'
  return normalized
}
