import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { EditorView, keymap } from '@codemirror/view'
import { Compartment, EditorState } from '@codemirror/state'
import { use, useEffect, useRef } from 'react'
import { editorTheme } from '@src/editor/plugins/theme'
import { getResolvedTheme } from '@src/lib/theme'
import { useSingletons } from '@src/lib/boot'
import { parse, resultIsOk } from '@src/lang/wasm'
import { err } from '@src/lib/trap'
import { varMentions } from '@src/lib/varCompletionExtension'
import styles from './KclInput.module.css'
import { DUMMY_VARIABLE_NAME } from '@src/lib/kclHelpers'

export function KclInput(props: {
  initialValue: string
  x: number
  y: number
  onSubmit: (value: string) => void | Promise<void>
  onCancel: () => void
  style?: React.CSSProperties
}) {
  const { useSettings, rustContext, kclManager } = useSingletons()
  const settings = useSettings()
  const wasmInstance = use(rustContext.wasmInstancePromise)

  const variables = kclManager.variablesSignal.value

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
          compartments.varMentions.of(
            varMentions(
              Object.keys(variables).map((key) => ({
                label: key,
              }))
            )
          ),
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
                  void props.onSubmit(value)
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
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            const value = update.state.doc.toString().trim()
            if (!value) {
              containerRef.current?.classList.remove(styles.error)
              return
            }
            const code = `${DUMMY_VARIABLE_NAME} = ${value}`
            const result = parse(code, wasmInstance)
            if (err(result) || !resultIsOk(result)) {
              console.log('err', result)
              containerRef.current?.classList.add(styles.error)
            } else {
              containerRef.current?.classList.remove(styles.error)
            }
          }),
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

    const onPointerDown = (e: PointerEvent) => {
      if (e.button === 1) {
        // Allow middle mouse for panning camera, don't cancel
        return
      }
      if (
        !(e.target instanceof Node) ||
        !containerRef.current?.contains(e.target)
      ) {
        props.onCancel()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)

    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      editor.destroy()
      editorRef.current = null
    }
    // This useEffect is mount-only: editor is created once on mount, updates are handled via compartment reconfiguration,
    // so deliberately no dependencies are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!editorRef.current) return
    editorRef.current.dispatch({
      effects: compartmentsRef.current.theme.reconfigure(
        editorTheme[getResolvedTheme(settings.app.theme.current)]
      ),
    })
  }, [settings.app.theme])

  useEffect(() => {
    if (!editorRef.current) return
    editorRef.current.dispatch({
      effects: compartmentsRef.current.varMentions.reconfigure(
        varMentions(
          Object.keys(variables).map((key) => ({
            label: key,
          }))
        )
      ),
    })
  }, [variables])

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
