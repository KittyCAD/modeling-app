import { invertedEffects } from '@codemirror/commands'
import { type Extension, StateEffect } from '@codemirror/state'

export const requestWriteToFile = StateEffect.define<boolean>()

/**
 * And extension that allows write-related state effects to be included
 * when undoing and redoing, by providing their values as invertedEffects.
 * We do not transform their values: undoing an write edit will write again.
 */
export function writeEffectsExtension(): Extension {
  const undoableWrite = invertedEffects.of((tr) => {
    const found: StateEffect<unknown>[] = []
    for (const e of tr.effects) {
      if (e.is(requestWriteToFile)) {
        found.push(requestWriteToFile.of(e.value))
      }
    }
    return found
  })

  return [undoableWrite]
}
