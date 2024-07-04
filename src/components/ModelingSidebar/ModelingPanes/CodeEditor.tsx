import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from 'react'
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

interface CodeEditorRef {
  editor?: HTMLDivElement | null
  view?: EditorView
  state?: EditorState
}

interface CodeEditorProps {
  onCreateEditor?: (view: EditorView | null) => void
  initialDocValue?: EditorStateConfig['doc']
  extensions?: Extension
  theme: 'light' | 'dark'
  autoFocus?: boolean
  selection?: EditorStateConfig['selection']
}

interface UseCodeMirror extends CodeEditorProps {
  container?: HTMLDivElement | null
}

const CodeEditor = forwardRef<CodeEditorRef, CodeEditorProps>((props, ref) => {
  const {
    onCreateEditor,
    extensions = [],
    initialDocValue,
    theme,
    autoFocus = false,
    selection,
  } = props
  const editor = useRef<HTMLDivElement>(null)

  const { view, state, container } = useCodeMirror({
    container: editor.current,
    onCreateEditor,
    extensions,
    initialDocValue,
    theme,
    autoFocus,
    selection,
  })

  useImperativeHandle(
    ref,
    () => ({ editor: editor.current, view: view, state: state }),
    [editor, container, view, state]
  )

  return <div ref={editor}></div>
})

export function useCodeMirror(props: UseCodeMirror) {
  const {
    onCreateEditor,
    extensions = [],
    initialDocValue,
    theme,
    autoFocus = false,
    selection,
  } = props

  const [container, setContainer] = useState<HTMLDivElement | null>()
  const [view, setView] = useState<EditorView>()
  const [state, setState] = useState<EditorState>()

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
    if (container && !state) {
      const config = {
        doc: initialDocValue,
        selection,
        extensions: [...Array.of(extensions)],
      }
      const stateCurrent = EditorState.create(config)
      setState(stateCurrent)
      if (!view) {
        const viewCurrent = new EditorView({
          state: stateCurrent,
          parent: container,
        })
        setView(viewCurrent)
        onCreateEditor && onCreateEditor(viewCurrent)
      }
    }
    return () => {
      if (view) {
        setState(undefined)
        setView(undefined)
      }
    }
  }, [container, state])

  useEffect(() => setContainer(props.container), [props.container])

  useEffect(
    () => () => {
      if (view) {
        view.destroy()
        setView(undefined)
      }
    },
    [view]
  )

  useEffect(() => {
    if (autoFocus && view) {
      view.focus()
    }
  }, [autoFocus, view])

  useEffect(() => {
    if (view && !isFirstRender) {
      view.dispatch({
        effects: StateEffect.reconfigure.of(targetExtensions),
      })
    }
  }, [targetExtensions])

  return { view, setView, container, setContainer, state, setState }
}

export default CodeEditor
