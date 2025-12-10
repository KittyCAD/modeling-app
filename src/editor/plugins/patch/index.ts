import {
  ChangeSpec,
  EditorState,
  Extension,
  StateEffect,
  StateField,
} from '@codemirror/state'
import { EditorView } from 'codemirror'

export const updatePatchEdit = StateEffect.define<ChangeSpec>()
export const commitPatchEdit = StateEffect.define()

const basePatch = (state: EditorState) => ({
  from: state.doc.length,
  insert: '',
})

/** StateField to hold the current artifact graph reference on the EditorState */
export const patchEdit = StateField.define<ChangeSpec>({
  create(state) {
    return basePatch(state)
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(updatePatchEdit)) {
        return e.value ?? basePatch(tr.state)
      }
    }
    return value
  },
})

const commitPatch = EditorState.transactionFilter.of((tr) => {
  if (tr.effects.some((e) => e.is(commitPatchEdit))) {
    const state = tr.state
    const currentPatch = state.field(patchEdit)
    console.log('looks like we are trying to commit a patch', currentPatch)
    return [
      tr,
      {
        changes: currentPatch,
        effects: [updatePatchEdit.of(basePatch(state))],
      },
    ]
  } else {
    return tr
  }
})

const _commitPatch = EditorView.updateListener.of((update) => {
  for (const tr of update.transactions) {
    for (const e of tr.effects) {
      if (e.is(commitPatchEdit)) {
        const currentPatch = update.state.field(patchEdit)
        console.log('committing patch: ', currentPatch)
        update.view.dispatch({
          changes: currentPatch,
          // Clear the current patch
          effects: [updatePatchEdit.of({ from: update.state.doc.length })],
        })
      }
    }
  }
})

export function patchEditor(): Extension {
  return [patchEdit, commitPatch]
}
