import { markdown } from '@codemirror/lang-markdown'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState, type Extension } from '@codemirror/state'
import { EditorView, lineNumbers } from '@codemirror/view'
import { kcl } from '@kittycad/codemirror-lang-kcl'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'

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
  compact?: boolean
  vividChanges?: boolean
  testId?: string
  layout?: 'split' | 'unified'
  fullHeight?: boolean
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
    cursor: 'text',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  },
  '.cm-line': {
    paddingInline: '0.5rem',
  },
  '&.cm-focused': {
    outline: 'none',
  },
})

const vividDiffChangeTheme: Record<ResolvedTheme, Extension> = {
  light: EditorView.theme(
    {
      '&.cm-merge-a .cm-changedLine': {
        backgroundColor: 'oklch(var(--_fern-20) / 0.26)',
      },
      '&.cm-merge-b .cm-changedLine': {
        backgroundColor: 'oklch(var(--_river-20) / 0.34)',
      },
      '&.cm-merge-a .cm-changedText': {
        background: 'oklch(var(--_fern-30) / 0.72)',
        borderRadius: '2px',
      },
      '&.cm-merge-b .cm-changedText': {
        background: 'oklch(var(--_river-30) / 0.72)',
        borderRadius: '2px',
      },
      '.cm-changeGutter': {
        width: '4px',
        paddingLeft: '1px',
      },
      '&.cm-merge-a .cm-changedLineGutter': {
        background: 'oklch(var(--_fern-70) / 1)',
      },
      '&.cm-merge-b .cm-changedLineGutter': {
        background: 'oklch(var(--_river-70) / 1)',
      },
    },
    {
      dark: false,
    }
  ),
  dark: EditorView.theme(
    {
      '&.cm-merge-a .cm-changedLine': {
        backgroundColor: 'oklch(var(--_fern-90) / 0.5)',
      },
      '&.cm-merge-b .cm-changedLine': {
        backgroundColor: 'oklch(var(--_river-90) / 0.58)',
      },
      '&.cm-merge-a .cm-changedText': {
        background: 'oklch(var(--_fern-60) / 0.58)',
        borderRadius: '2px',
      },
      '&.cm-merge-b .cm-changedText': {
        background: 'oklch(var(--_river-60) / 0.62)',
        borderRadius: '2px',
      },
      '.cm-changeGutter': {
        width: '4px',
        paddingLeft: '1px',
      },
      '&.cm-merge-a .cm-changedLineGutter': {
        background: 'oklch(var(--_fern-40) / 1)',
      },
      '&.cm-merge-b .cm-changedLineGutter': {
        background: 'oklch(var(--_river-40) / 1)',
      },
    },
    {
      dark: true,
    }
  ),
}

const compactDiffEditorTheme = EditorView.theme({
  '&': {
    fontSize: '0.75rem',
    lineHeight: '1.125rem',
  },
})

function diffEditorExtensions(
  language: CodeDiffLanguage,
  resolvedTheme: ResolvedTheme,
  labelId: string,
  compact: boolean,
  vividChanges: boolean
): Extension[] {
  return [
    ...languageExtensions(language, resolvedTheme),
    diffEditorTheme,
    vividChanges ? vividDiffChangeTheme[resolvedTheme] : [],
    compact ? compactDiffEditorTheme : [],
    lineNumbers(),
    EditorState.readOnly.of(true),
    // Keep the content DOM interactive for native selection and copying.
    // The read-only state above still rejects document changes.
    EditorView.editable.of(true),
    EditorView.contentAttributes.of({
      'aria-labelledby': labelId,
    }),
  ]
}

export function CodeDiffView({
  beforeText,
  afterText,
  beforeLabel,
  afterLabel,
  language,
  resolvedTheme,
  compact = false,
  vividChanges = false,
  testId,
  layout = 'split',
  fullHeight = false,
}: CodeDiffViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const beforeLabelId = useId()
  const afterLabelId = useId()

  useEffect(() => {
    if (!containerRef.current) {
      return
    }

    if (layout === 'unified') {
      const view = new EditorView({
        doc: afterText,
        extensions: [
          ...diffEditorExtensions(
            language,
            resolvedTheme,
            afterLabelId,
            compact,
            false
          ),
          unifiedMergeView({
            original: beforeText,
            mergeControls: false,
            collapseUnchanged: { margin: 3, minSize: 8 },
            diffConfig: { timeout: 1000 },
          }),
          EditorView.lineWrapping,
          fullHeight ? EditorView.theme({ '&': { height: '100%' } }) : [],
        ],
        parent: containerRef.current,
      })
      return () => view.destroy()
    }

    const mergeView = new MergeView({
      a: {
        doc: beforeText,
        extensions: diffEditorExtensions(
          language,
          resolvedTheme,
          beforeLabelId,
          compact,
          vividChanges
        ),
      },
      b: {
        doc: afterText,
        extensions: diffEditorExtensions(
          language,
          resolvedTheme,
          afterLabelId,
          compact,
          vividChanges
        ),
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
  }, [
    afterLabelId,
    afterText,
    beforeLabelId,
    beforeText,
    compact,
    language,
    resolvedTheme,
    vividChanges,
    layout,
    fullHeight,
  ])

  return (
    <>
      <div
        className={`mb-2 shrink-0 gap-3 text-xs font-medium text-chalkboard-70 dark:text-chalkboard-30 ${layout === 'split' ? 'grid grid-cols-2' : 'flex justify-between'}`}
      >
        <span id={beforeLabelId}>
          {layout === 'unified' && (
            <span className="mr-1 text-red-600 dark:text-red-400">-</span>
          )}
          {beforeLabel}
        </span>
        <span id={afterLabelId}>
          {layout === 'unified' && (
            <span className="mr-1 text-green-700 dark:text-green-400">+</span>
          )}
          {afterLabel}
        </span>
      </div>
      <div
        ref={containerRef}
        data-testid={testId}
        className={`w-full max-w-full min-w-0 overflow-auto rounded border border-chalkboard-20 dark:border-chalkboard-70 [&_.cm-editor]:max-w-full [&_.cm-editor]:min-w-0 [&_.cm-mergeView]:max-w-full [&_.cm-mergeView]:min-w-0 [&_.cm-mergeView]:overflow-auto [&_.cm-mergeView]:w-full [&_.cm-mergeViewEditor]:max-w-full [&_.cm-mergeViewEditor]:min-w-0 [&_.cm-mergeViewEditors]:max-w-full [&_.cm-mergeViewEditors]:min-w-0 [&_.cm-mergeViewEditors]:w-full [&_.cm-scroller]:overflow-auto ${fullHeight ? 'min-h-0 flex-1' : 'max-h-[18rem] min-h-32 [&_.cm-mergeView]:max-h-[18rem]'}`}
      />
    </>
  )
}
