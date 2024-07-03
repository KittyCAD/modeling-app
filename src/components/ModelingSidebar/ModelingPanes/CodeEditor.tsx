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
  onView: (view: EditorView | null) => void
  initialDocValue?: EditorStateConfig['doc']
  extensions?: Extension
  theme: 'light' | 'dark'
}

const CodeEditor: React.FC<ICodeEditor> = ({
  onView,
  extensions = [],
  initialDocValue,
  theme,
}) => {
  const [editorView, setEditorView] = useState<EditorView | null>(null)

  const isFirstRender = useFirstRender()

  const editorRef = useRef<HTMLElement>(null)

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

  useEffect(() => {
    if (editorRef.current === null) return

    const view = new EditorView({
      state: EditorState.create({
        doc: initialDocValue,
        extensions: [...Array.of(extensions)],
      }),
      parent: editorRef.current,
    })

    setEditorView(view)
    onView(view)

    return () => {
      view.destroy()
      onView(null)
    }
  }, [])

  return <section ref={editorRef}></section>
}

export default CodeEditor
