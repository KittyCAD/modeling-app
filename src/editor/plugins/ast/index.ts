import type { Extension } from '@codemirror/state'
import { StateEffect, StateField } from '@codemirror/state'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@src/lang/wasm'

/** Effect used to replace the current artifact graph in state */
export const setAstEffect = StateEffect.define<Node<Program> | null>()

const emptyAst = {
  body: [],
  commentStart: 0,
  start: 0,
  end: 0,
  moduleId: 0,
}

/** StateField to hold the current artifact graph reference on the EditorState */
export const astStateField = StateField.define<Node<Program>>({
  create() {
    return emptyAst
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setAstEffect)) {
        return e.value ?? emptyAst
      }
    }
    return value
  },
})

export function kclAstExtension(): Extension {
  return [astStateField]
}
