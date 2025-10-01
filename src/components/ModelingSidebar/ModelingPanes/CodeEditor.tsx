import type { EditorStateConfig, Extension } from '@codemirror/state'
import { EditorState, StateEffect } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { EditorView } from '@codemirror/view'
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'

import { isArray } from '@src/lib/utils'

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

  const { view, container } = useCodeMirror({
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
    () => ({ editor: editor.current, view: view, state: view?.state }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
    [editor, container, view]
  )

  return <div ref={editor}></div>
})

/**
 * The extensions type is quite weird.  We need a special helper to preserve the
 * readonly array type.
 *
 * @see https://github.com/microsoft/TypeScript/issues/17002
 */
function isExtensionArray(
  extensions: Extension
): extensions is readonly Extension[] {
  return isArray(extensions)
}

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
    let exts = isExtensionArray(extensions) ? extensions : []
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
        onCreateEditor?.(viewCurrent)
      }
    }
    return () => {
      if (view) {
        setState(undefined)
        setView(undefined)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [container, state])

  useEffect(() => setContainer(props.container), [props.container])

  useEffect(
    () => () => {
      if (view) {
        view.destroy()
        setView(undefined)
        onCreateEditor?.(null)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
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
  }, [targetExtensions, view, isFirstRender])

  return { view, container, setContainer, state }
}

export default CodeEditor
