import type { HoleBottom, HoleType } from '@src/lang/modifyAst/faces'
import { hasModelingDialogValue } from '@src/lib/commandBarConfigs/modelingDialogShared'

export function getHoleType(
  argumentsToSubmit: Record<string, unknown>
): HoleType {
  const { holeType } = argumentsToSubmit
  if (
    holeType === 'simple' ||
    holeType === 'counterbore' ||
    holeType === 'countersink'
  ) {
    return holeType
  }
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
}

export function getHoleBottom(
  argumentsToSubmit: Record<string, unknown>
): HoleBottom {
  const { holeBottom } = argumentsToSubmit
  if (holeBottom === 'flat' || holeBottom === 'drill') {
    return holeBottom
  }
  return hasModelingDialogValue(argumentsToSubmit.drillPointAngle)
    ? 'drill'
    : 'flat'
}

/** Clear dimensions that do not belong to the selected hole constructors. */
export function normalizeHoleDialogArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const holeType = getHoleType(argumentsToSubmit)
  const holeBottom = getHoleBottom(argumentsToSubmit)
  const normalized: Record<string, unknown> = {
    ...argumentsToSubmit,
    holeBody: 'blind',
    holeType,
    holeBottom,
  }
  if (holeType !== 'counterbore') {
    normalized.counterboreDepth = undefined
    normalized.counterboreDiameter = undefined
  }
  if (holeType !== 'countersink') {
    normalized.countersinkAngle = undefined
    normalized.countersinkDiameter = undefined
    normalized.countersinkHeadClearance = undefined
  }
  if (holeBottom === 'flat') {
    normalized.drillPointAngle = undefined
  }
  return normalized
}
