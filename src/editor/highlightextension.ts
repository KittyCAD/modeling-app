import { Annotation, StateEffect, StateField } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

export { EditorView }

export const addLineHighlight = StateEffect.define<Array<[number, number]>>()

const addLineHighlightAnnotation = Annotation.define<null>()
export const addLineHighlightEvent = addLineHighlightAnnotation.of(null)

export const lineHighlightField = StateField.define({
  create() {
    return Decoration.none
  },
  update(lines, tr) {
    lines = lines.map(tr.changes)

    const isLineHighlightEvent = tr.annotation(addLineHighlightEvent.type)
    if (isLineHighlightEvent === undefined) {
      return lines
    }

    const deco = []
    for (let e of tr.effects) {
      if (e.is(addLineHighlight)) {
        lines = Decoration.none
        for (let index = 0; index < e.value.length; index++) {
          const highlightRange = e.value[index]
          const [from, to] = highlightRange || [0, 0]
          if (from && to && !(from === to && from === 0)) {
            if (index === 0) {
              lines = lines.update({ add: [matchDeco.range(from, to)] })
              deco.push(matchDeco.range(from, to))
            } else {
              lines = lines.update({ add: [matchDeco2.range(from, to)] })
              deco.push(matchDeco2.range(from, to))
            }
          }
        }
      }
    }
    return lines
  },
  provide: (f) => EditorView.decorations.from(f),
})

const matchDeco = Decoration.mark({
  class: 'bg-yellow-300/70 dark:bg-blue-800/50',
  attributes: { 'data-testid': 'hover-highlight' },
})
const matchDeco2 = Decoration.mark({
  class: 'bg-yellow-200/40 dark:bg-blue-700/50',
  attributes: { 'data-testid': 'hover-highlight' },
})
