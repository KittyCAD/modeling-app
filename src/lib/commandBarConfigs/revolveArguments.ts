import { hasCommandArgumentValue } from '@src/lib/commandBarConfigs/modelingCommandUtils'

export function getRevolveAxisMode(
  argumentsToSubmit: Record<string, unknown>
): 'Axis' | 'Edge' {
  const { axisOrEdge } = argumentsToSubmit
  if (axisOrEdge === 'Axis' || axisOrEdge === 'Edge') {
    return axisOrEdge
  }
  return hasCommandArgumentValue(argumentsToSubmit.edge) ? 'Edge' : 'Axis'
}

/** Submit only the selected representation of the revolve axis. */
export function normalizeRevolveArguments(
  argumentsToSubmit: Record<string, unknown>
): Record<string, unknown> {
  const axisOrEdge = getRevolveAxisMode(argumentsToSubmit)
  return {
    ...argumentsToSubmit,
    axisOrEdge,
    ...(axisOrEdge === 'Axis' ? { edge: undefined } : { axis: undefined }),
  }
}
