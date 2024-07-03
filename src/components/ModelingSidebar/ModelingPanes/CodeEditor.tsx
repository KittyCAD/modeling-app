import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  EditorState,
  EditorStateConfig,
  Extension,
  StateEffect,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { oneDark } from '@codemirror/theme-one-dark'

//reference: https://github.com/sachinraja/rodemirror/blob/main/src/use-first-render.ts
const useFirstRender = () => {
  const firstRender = useRef(true)

  useEffect(() => {
    firstRender.current = false
  }, [])

  return firstRender.current
}

const defaultLightThemeOption = EditorView.theme(
  {
    '&': {
      backgroundColor: '#fff',
    },
  },
  {
    dark: false,
  }
)

interface ICodeEditor {
  onView?: (view: EditorView | null) => void
  initialDocValue?: EditorStateConfig['doc']
  extensions?: Extension
  theme: 'light' | 'dark'
  autoFocus?: boolean
  selection?: EditorStateConfig['selection']
}

interface UseCodeMirror extends ICodeEditor {
  container?: HTMLDivElement | null
}

const CodeEditor: React.FC<ICodeEditor> = ({
  onView,
  extensions = [],
  initialDocValue,
  theme,
  autoFocus = false,
  selection,
}) => {
  const editorRef = useRef<HTMLDivElement>(null)

  useCodeMirror({
    container: editorRef.current,
    onView,
    extensions,
    initialDocValue,
    theme,
    autoFocus,
    selection,
  })

  return <section ref={editorRef}></section>
}

export function useCodeMirror(props: UseCodeMirror) {
  const {
    onView,
    extensions = [],
    initialDocValue,
    theme,
    autoFocus = false,
    selection,
  } = props

  const [container, setContainer] = useState<HTMLDivElement | null>()
  const [editorView, setEditorView] = useState<EditorView | null>(null)

  const isFirstRender = useFirstRender()

  const targetExtensions = useMemo(() => {
    let exts = Array.isArray(extensions) ? extensions : []
    if (theme === 'dark') {
      exts = [...exts, oneDark]
    } else if (theme === 'light') {
      exts = [...exts, defaultLightThemeOption]
    }

    return exts
  }, [extensions, theme])

  useEffect(() => {
    if (isFirstRender || !editorView) return
    console.log('reconfigure', targetExtensions)

    editorView.dispatch({
      effects: StateEffect.reconfigure.of(targetExtensions),
    })
  }, [targetExtensions])

  useEffect(() => setContainer(props.container), [props.container])

  useEffect(() => {
    if (container === null) return

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDocValue,
        extensions: [...Array.of(extensions)],
        selection,
      }),
      parent: container,
    })

    setEditorView(view)
    if (onView) {
      onView(view)
    }

    return () => {
      view.destroy()
      if (onView) {
        onView(null)
      }
    }
  }, [container])

  useEffect(() => {
    if (autoFocus && editorView) {
      editorView.focus()
    }
  }, [autoFocus, editorView])

  return { editorView, setEditorView, container, setContainer }
}

export default CodeEditor
