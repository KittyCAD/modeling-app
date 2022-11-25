import { StateField, StateEffect } from '@codemirror/state'
import { EditorView, Decoration } from '@codemirror/view'

export { EditorView }

export const addLineHighlight = StateEffect.define<[number, number]>()

export const lineHighlightField = StateField.define({
  create() {
    return Decoration.none
  },
  update(lines, tr) {
    lines = lines.map(tr.changes)
    const deco = []
    for (let e of tr.effects) {
      if (e.is(addLineHighlight)) {
        lines = Decoration.none
        const [from, to] = e.value
        if (!(from === to && from === 0)) {
          lines = lines.update({ add: [matchDeco.range(from, to)] })
          deco.push(matchDeco.range(from, to))
        }
      }
    }
    return lines
  },
  provide: (f) => EditorView.decorations.from(f),
})

const matchDeco = Decoration.mark({ class: 'bg-yellow-200' })
