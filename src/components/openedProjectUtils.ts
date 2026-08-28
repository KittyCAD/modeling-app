export interface ModelingStateMatcher {
  matches: (...args: any[]) => boolean
}

export type ZookeeperProjectReloadBehavior =
  | 'exit-sketch-solve'
  | 'execute-without-camera-reset'

export function getZookeeperProjectReloadBehavior(
  modelingState?: ModelingStateMatcher | null
): ZookeeperProjectReloadBehavior {
  if (modelingState?.matches('sketchSolveMode')) {
    return 'exit-sketch-solve'
  }

  return 'execute-without-camera-reset'
}
