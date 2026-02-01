import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { useEffect, useRef } from 'react'
import { editorTheme } from '@src/editor/plugins/theme'
import { getResolvedTheme } from '@src/lib/theme'
import { useSingletons } from '@src/lib/boot'
import styles from '@src/components/KclInput.module.css'

export function KclInput(props: {
  initialValue: string
  x: number
  y: number
  onSubmit: (value: string) => void
  onCancel: () => void
  style?: React.CSSProperties
}) {
  const { useSettings } = useSingletons()
  const settings = useSettings()

  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<EditorView | null>(null)
  const compartmentsRef = useRef({
    theme: new Compartment(),
    varMentions: new Compartment(),
    setValue: new Compartment(),
    keymap: new Compartment(),
    kclLsp: new Compartment(),
    kclAutocomplete: new Compartment(),
  })

  useEffect(() => {
    if (!containerRef.current) return

    const compartments = compartmentsRef.current
    const editor = new EditorView({
      state: EditorState.create({
        doc: props.initialValue,
        extensions: [
          compartments.theme.of(
            editorTheme[getResolvedTheme(settings.app.theme.current)]
          ),
          compartments.varMentions.of([]),
          compartments.setValue.of([]),
          compartments.kclLsp.of([]),
          compartments.kclAutocomplete.of([]),
          closeBrackets(),
          keymap.of([
            {
              key: 'Enter',
              run: (editorView) => {
                const value = editorView.state.doc.toString().trim()
                if (value) {
                  props.onSubmit(value)
                  return true
                }
                return false
              },
            },
            {
              key: 'Escape',
              run: () => {
                props.onCancel()
                return true
              },
            },
            ...closeBracketsKeymap,
            ...completionKeymap,
          ]),
          compartments.keymap.of([]),
        ],
      }),
      parent: containerRef.current,
    })
    // Focus and select all
    editor.focus()
    editor.dispatch({
      selection: { anchor: 0, head: editor.state.doc.length },
    })
    editorRef.current = editor

    return () => {
      editor.destroy()
      editorRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!editorRef.current) return
    editorRef.current.dispatch({
      effects: compartmentsRef.current.theme.reconfigure(
        editorTheme[getResolvedTheme(settings.app.theme.current)]
      ),
    })
  }, [settings.app.theme])

  return (
    <div
      ref={containerRef}
      className={styles.container}
      style={{
        left: props.x,
        top: props.y,
        position: 'absolute',
        ...props.style,
      }}
    />
  )
}
