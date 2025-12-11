import type { Extension } from '@codemirror/state'
import { Annotation, StateEffect, StateField } from '@codemirror/state'
import type { Node } from '@rust/kcl-lib/bindings/Node'
import type { Program } from '@src/lang/wasm'

/** Effect used to replace the current artifact graph in state */
export const setAstEffect = StateEffect.define<Node<Program> | null>()

export const createEmptyAst = (): Node<Program> => ({
  body: [],
  shebang: null,
  start: 0,
  end: 0,
  moduleId: 0,
  nonCodeMeta: {
    nonCodeNodes: {},
    startNodes: [],
  },
  innerAttrs: [],
  outerAttrs: [],
  preComments: [],
  commentStart: 0,
})

/** StateField to hold the current artifact graph reference on the EditorState */
export const astStateField = StateField.define<Node<Program>>({
  create() {
    return createEmptyAst()
  },
  update(value, tr) {
    for (const e of tr.effects) {
      if (e.is(setAstEffect)) {
        return e.value ?? createEmptyAst()
      }
    }
    return value
  },
})

/** an annotation to mark AST update effects */
export const updateAstAnnotation = Annotation.define<boolean>()

export function kclAstExtension(): Extension {
  return [astStateField]
}
