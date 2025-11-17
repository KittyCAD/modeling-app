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
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'

//reference: https://github.com/sachinraja/rodemirror/blob/main/src/use-first-render.ts
const useFirstRender = () => {
  const firstRender = useRef(true)

  useEffect(() => {
    firstRender.current = false
  }, [])

  return firstRender.current
}

const green = {
  light: 'oklch(from var(--primary) calc(l) calc(c + .15) calc(h - 90))',
  dark: 'oklch(from var(--primary) calc(l + 0.2) c calc(h - 90))',
}
const orange = {
  light: 'oklch(from var(--primary) calc(l + 0.05) calc(c + .1) calc(h - 180))',
  dark: 'oklch(from var(--primary) calc(l + 0.25) calc(c + .1) calc(h - 180))',
}
const textDefault = {
  light: 'var(--chalkboard-100)',
  dark: 'var(--chalkboard-20)',
}
const textFaded = {
  light: 'var(--chalkboard-70)',
  dark: 'var(--chalkboard-30)',
}
const magenta = {
  light: 'oklch(from var(--primary) calc(l + 0.05) c calc(h + 90))',
}
const primary = {
  light: 'var(--primary)',
  dark: 'oklch(from var(--primary) calc(l + 0.15) c h)',
}
const colors = {
  green,
  magenta,
  orange,
  primary,
  textDefault,
  textFaded,
}
const baseKclHighlights = HighlightStyle.define([
  {
    tag: [tags.keyword, tags.annotation],
    color: colors.orange.light,
  },
  {
    tag: [tags.number, tags.string, tags.tagName],
    color: colors.green.light,
    fontWeight: 'normal',
  },
  {
    tag: [tags.attributeName, tags.definition(tags.propertyName)],
    color: colors.magenta.light,
    fontWeight: 'normal',
  },
  { tag: tags.function(tags.variableName), color: colors.textDefault.light },
  {
    tag: tags.definitionKeyword,
    backgroundColor: 'oklch(from var(--primary) calc(l + 0.05) c h / .1)',
    color: colors.primary,
    borderRadius: '2px',
  },
  { tag: [tags.variableName], color: colors.primary },
  { tag: tags.comment, color: colors.textFaded.light, fontStyle: 'italic' },
  {
    tag: tags.definition(tags.variableName),
    color: colors.textFaded.light,
    fontWeight: 'bold',
  },
  { tag: tags.controlOperator, color: colors.textFaded.light },
  {
    tag: [tags.paren, tags.brace, tags.bracket],
    color: colors.textFaded.light,
    fontWeight: 'bold',
  },
])

const darkKclHighlights = HighlightStyle.define(
  [
    {
      tag: [tags.keyword, tags.annotation],
      color: colors.orange.dark,
    },
    {
      tag: tags.definitionKeyword,
      backgroundColor: 'oklch(from var(--primary) calc(l + 0.25) c h / .2)',
      color: colors.primary.dark,
    },
    { tag: tags.function(tags.variableName), color: colors.textDefault.dark },
    {
      tag: [tags.variableName],
      color: colors.primary.dark,
    },
    {
      tag: [tags.number, tags.string, tags.tagName],
      color: colors.green.dark,
      fontWeight: 'normal',
    },
    { tag: tags.comment, color: 'var(--chalkboard-30)', fontStyle: 'italic' },
    {
      tag: tags.definition(tags.variableName),
      color: 'var(--chalkboard-30)',
      fontWeight: 'bold',
    },
    { tag: tags.atom, color: 'var(--chalkboard-40)' },
    { tag: tags.controlOperator, color: 'var(--chalkboard-30)' },
    {
      tag: [tags.paren, tags.brace, tags.bracket],
      color: 'var(--chalkboard-30)',
      fontWeight: 'bold',
    },
  ],
  {
    themeType: 'dark',
  }
)

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
const lightTheme = [
  defaultLightThemeOption,
  syntaxHighlighting(baseKclHighlights),
]
const defaultDarkThemeOption = EditorView.theme(
  {
    '&': {
      backgroundColor: 'transparent',
    },
  },
  {
    dark: true,
  }
)
const darkTheme = [
  defaultDarkThemeOption,
  syntaxHighlighting(darkKclHighlights),
  syntaxHighlighting(baseKclHighlights),
]

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
      exts = [...exts, darkTheme]
    } else if (theme === 'light') {
      exts = [...exts, lightTheme]
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
