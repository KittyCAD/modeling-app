import { history, undo } from '@codemirror/commands'
import { forceParsing, syntaxTreeAvailable } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { KclLanguage } from '@kittycad/codemirror-lang-kcl'
import { colorPicker } from '@src/lang/lsp/kcl/colors'
import { afterEach, describe, expect, it } from 'vitest'

// Put the color beyond CodeMirror's initial synchronous parse window while
// keeping it in the visible viewport. The remaining syntax arrives separately
// from document edits or scrolling.
const longDocument = `// ${'padding '.repeat(400)}
appearance(color = "#ff00ff", metalness = 70, roughness = 50)`

describe('KCL color picker', () => {
  let view: EditorView | undefined

  function createEditor(doc: string) {
    view = new EditorView({
      doc,
      extensions: [KclLanguage, colorPicker, history()],
      parent: document.body,
    })
    return view
  }

  afterEach(() => {
    view?.destroy()
    view?.dom.remove()
    view = undefined
  })

  it.each(['"', "'"])(
    'shows a swatch for a hex literal with %s quotes',
    (quote) => {
      const editor = createEditor(`color = ${quote}#ff00ff${quote}`)

      expect(
        editor.dom.querySelector<HTMLInputElement>('input[type="color"]')?.value
      ).toBe('#ff00ff')
    }
  )

  it('shows a swatch when background parsing reaches a visible color', () => {
    const editor = createEditor(longDocument)
    expect(syntaxTreeAvailable(editor.state)).toBe(false)
    expect(editor.dom.querySelector('input[type="color"]')).toBeNull()

    // Finish the real KCL parse and dispatch its syntax-only update.
    expect(forceParsing(editor, editor.state.doc.length)).toBe(true)

    expect(editor.state.doc.toString()).toBe(longDocument)
    expect(
      editor.dom.querySelector<HTMLInputElement>('input[type="color"]')?.value
    ).toBe('#ff00ff')
  })

  it('edits only the color literal through the restored picker and supports undo', () => {
    const editor = createEditor(longDocument)
    expect(forceParsing(editor, editor.state.doc.length)).toBe(true)

    const picker = editor.dom.querySelector<HTMLInputElement>(
      'input[type="color"]'
    )
    if (!picker) throw new Error('Expected a color picker after parsing')

    picker.value = '#00ff00'
    picker.dispatchEvent(new Event('change', { bubbles: true }))

    expect(editor.state.doc.toString()).toBe(
      longDocument.replace('"#ff00ff"', '"#00ff00"')
    )
    expect(undo(editor)).toBe(true)
    expect(editor.state.doc.toString()).toBe(longDocument)
    expect(
      editor.dom.querySelector<HTMLInputElement>('input[type="color"]')?.value
    ).toBe('#ff00ff')
  })
})
