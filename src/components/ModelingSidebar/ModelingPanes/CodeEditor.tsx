import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  EditorState,
  EditorStateConfig,
  Extension,
  StateEffect,
} from '@codemirror/state'
import { EditorView } from '@codemirror/view'

//reference: https://github.com/sachinraja/rodemirror/blob/main/src/use-first-render.ts
const useFirstRender = () => {
  const firstRender = useRef(true)

  useEffect(() => {
    firstRender.current = false
  }, [])

  return firstRender.current
}

interface ICodeEditor {
  onView: (view: EditorView | null) => void
  initialDocValue?: EditorStateConfig['doc']
  extensions?: Extension
}

const CodeEditor: React.FC<ICodeEditor> = ({
  onView,
  extensions = [],
  initialDocValue,
}) => {
  const [editorView, setEditorView] = useState<EditorView | null>(null)

  const isFirstRender = useFirstRender()

  const editorRef = useRef<HTMLElement>(null)

  const targetExtensions = useMemo(() => {
    return Array.isArray(extensions) ? extensions : []
  }, [extensions])

  useEffect(() => {
    if (isFirstRender || !editorView) return

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
