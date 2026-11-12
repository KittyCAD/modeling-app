type ModelingModeMatcher = {
  matches: (state: 'Sketch' | 'sketchSolveMode') => boolean
}

export function isSketchSessionForViewControls(
  modelingState: ModelingModeMatcher
) {
  return (
    modelingState.matches('Sketch') || modelingState.matches('sketchSolveMode')
  )
}

export function shouldLockViewControls(
  modelingState: ModelingModeMatcher,
  allowOrbitInSketchMode: boolean
) {
  return (
    isSketchSessionForViewControls(modelingState) && !allowOrbitInSketchMode
  )
}
