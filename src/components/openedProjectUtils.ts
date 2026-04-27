export interface ModelingStateMatcher {
  matches: (...args: any[]) => boolean
}

export type MlEphantProjectReloadBehavior =
  | 'exit-sketch-solve'
  | 'execute-without-camera-reset'
  | 'execute-and-reset-camera'

export function getMlEphantProjectReloadBehavior(
  modelingState?: ModelingStateMatcher | null
): MlEphantProjectReloadBehavior {
  if (modelingState?.matches('sketchSolveMode')) {
    return 'exit-sketch-solve'
  }

  if (modelingState?.matches('Sketch')) {
    return 'execute-without-camera-reset'
  }

  return 'execute-and-reset-camera'
}
