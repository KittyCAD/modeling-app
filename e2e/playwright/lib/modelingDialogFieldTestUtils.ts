import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { EditorView, keymap, placeholder } from '@codemirror/view'

export function createModelingDialogField(initial: string) {
  const parent = document.getElementById('dialog')
  if (!parent) throw new Error('Missing dialog fixture')
  // CommandKclInput leaves Select All to the browser too.
  const view = new EditorView({
    doc: initial,
    parent,
    extensions: [
      closeBrackets(),
      keymap.of(closeBracketsKeymap),
      placeholder('Use defaults'),
      EditorView.contentAttributes.of({ 'aria-label': 'Length' }),
    ],
  })
  return { contents: () => view.state.doc.toString() }
}
