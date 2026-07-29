import { markdown } from '@codemirror/lang-markdown'
import { MergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'

import {
  editorMarkdownHighlight,
  editorTheme,
  editorVisualTheme,
} from '@src/editor/plugins/theme'
import type { ResolvedTheme } from '@src/lib/theme'

type CodeDiffViewProps = {
  beforeText: string
  afterText: string
  beforeLabel: ReactNode
  afterLabel: ReactNode
  language: CodeDiffLanguage
  resolvedTheme: ResolvedTheme
  testId?: string
}

export type CodeDiffLanguage = 'kcl' | 'markdown' | 'plain'

function languageExtensions(
  language: CodeDiffLanguage,
  resolvedTheme: ResolvedTheme
) {
  if (language === 'kcl') {
    return [kcl(), ...editorTheme[resolvedTheme]]
  }
  if (language === 'markdown') {
    return [
      markdown(),
      editorVisualTheme[resolvedTheme],
      editorMarkdownHighlight[resolvedTheme],
    ]
  }
  return [editorVisualTheme[resolvedTheme]]
}

const diffEditorTheme = EditorView.theme({
  '&': {
    maxWidth: '100%',
    minHeight: '8rem',
    minWidth: 0,
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    overflowX: 'auto',
  },
  '.cm-content': {
    paddingBlock: '0.5rem',
  },
  '.cm-line': {
    paddingInline: '0.5rem',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

function diffEditorExtensions(
  language: CodeDiffLanguage,
  resolvedTheme: ResolvedTheme
): Extension[] {
  return [
    ...languageExtensions(language, resolvedTheme),
    diffEditorTheme,
    lineNumbers(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
  ]
}

export function CodeDiffView({
  beforeText,
  afterText,
  beforeLabel,
  afterLabel,
  language,
  resolvedTheme,
  testId,
}: CodeDiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    const mergeView = new MergeView({
      a: {
        doc: beforeText,
        extensions: diffEditorExtensions(language, resolvedTheme),
      },
      b: {
        doc: afterText,
        extensions: diffEditorExtensions(language, resolvedTheme),
      },
      parent: containerRef.current,
      highlightChanges: true,
      gutter: true,
      revertControls: undefined,
      collapseUnchanged: {
        margin: 3,
        minSize: 8,
      },
      diffConfig: {
        timeout: 1000,
      },
    })

    return () => {
      mergeView.destroy()
    }
  }, [afterText, beforeText, language, resolvedTheme])

  return (
    <>
      <div className="mb-2 grid grid-cols-2 gap-3 text-xs font-medium text-chalkboard-70 dark:text-chalkboard-30">
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
      <div
        ref={containerRef}
        data-testid={testId}
        className="max-h-[18rem] min-h-32 w-full max-w-full min-w-0 overflow-auto rounded border border-chalkboard-20 dark:border-chalkboard-70 [&_.cm-editor]:max-w-full [&_.cm-editor]:min-w-0 [&_.cm-mergeView]:max-h-[18rem] [&_.cm-mergeView]:max-w-full [&_.cm-mergeView]:min-w-0 [&_.cm-mergeView]:overflow-auto [&_.cm-mergeView]:w-full [&_.cm-mergeViewEditor]:max-w-full [&_.cm-mergeViewEditor]:min-w-0 [&_.cm-mergeViewEditors]:max-w-full [&_.cm-mergeViewEditors]:min-w-0 [&_.cm-mergeViewEditors]:w-full [&_.cm-scroller]:overflow-auto"
      />
    </>
  )
}
