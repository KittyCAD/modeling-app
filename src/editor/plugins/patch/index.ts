import {
  ChangeSpec,
  EditorState,
  StateEffect,
  StateEffectType,
  StateField,
} from '@codemirror/state'

/** The sketch doc is a patch edit operated on and built up while in sketch mode */
export const sketchDoc = createPatchEditPlugin('truncatedSketch')
/** The command palette */
export const commandDoc = createPatchEditPlugin('commandPalette')

function createPatchEditPlugin(name: string) {
  const updatePatchEdit = StateEffect.define<ChangeSpec>()
  const commitPatchEdit = StateEffect.define()

  const basePatch = (state: EditorState) => ({
    from: state.doc.length,
    insert: '',
  })

  /** StateField to hold the current artifact graph reference on the EditorState */
  const patchEdit = StateField.define<ChangeSpec>({
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

  return {
    name,
    updateEffect: updatePatchEdit,
    commitEffect: commitPatchEdit,
    field: patchEdit,

    extension: [patchEdit, commitPatch],
  }
}
