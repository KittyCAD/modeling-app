import { invertedEffects } from '@codemirror/commands'
import { type Extension, StateEffect } from '@codemirror/state'

export const requestCameraReset = StateEffect.define<boolean>()
export const requestExecution = StateEffect.define<boolean>()

/**
 * And extension that allows execution-related state effects to be included
 * when undoing and redoing, by providing their values as invertedEffects.
 * We do not transform their values: undoing an executing edit will execute again.
 */
export function executionEffectsExtension(): Extension {
  const undoableExecution = invertedEffects.of((tr) => {
    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(requestCameraReset)) {
        found.push(requestCameraReset.of(e.value))
      } else if (e.is(requestExecution)) {
        found.push(requestExecution.of(e.value))
      }
    }
    return found
  })

  return [undoableExecution]
}
