import { useEffect, useRef } from 'react'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState, Prec } from '@codemirror/state'
import {
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import { getSettings, kclManager } from '@src/lib/singletons'
import { useSignals } from '@preact/signals-react/runtime'
import { useSettings } from '@src/lib/singletons'
import { parentPathRelativeToProject } from '@src/lib/paths'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { AreaTypeComponentProps } from '@src/lib/layout'
import { lintGutter } from '@codemirror/lint'
import { bracketMatching, foldGutter } from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'
import { useLspContext } from '@src/components/LspProvider'
import { editorTheme, themeCompartment } from '@src/lib/codeEditor'
import { getResolvedTheme } from '@src/lib/theme'
import { kclAstExtension } from '@src/editor/plugins/ast'
import { lineHighlightField } from '@src/editor/highlightextension'
import { historyCompartment } from '@src/editor/compartments'
import { history } from '@codemirror/commands'

async function setDiff(editorRef, mergeViewRef, absoluteFilePath, left, right, kclLSP) {
  const originalFile = await window.electron.readFile(absoluteFilePath, 'utf-8')
  if (mergeViewRef.current) {
    mergeViewRef.current.destroy()
  }

  const extensions = [
    themeCompartment.of(editorTheme[getResolvedTheme(getSettings().app.theme.current)]),
    kclAstExtension(),
    lineHighlightField,
    EditorView.editable.of(false),
    EditorState.readOnly.of(true),
    EditorView.lineWrapping,
    lintGutter(),
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    foldGutter(),
    EditorState.allowMultipleSelections.of(true),
    bracketMatching(),
    highlightActiveLine(),
    highlightSelectionMatches(),
    rectangularSelection(),
    dropCursor(),
    historyCompartment.of(history()),
    unifiedMergeView({
      original: left,
      mergeControls: false,
    }),
  ]

  if (kclLSP) {
    extensions.push(Prec.highest(kclLSP))
  }

  const mergeView = new EditorView({
    parent: editorRef.current,
    doc: right,
    extensions
  })

  mergeViewRef.current = mergeView
}

export const DiffView = (props: AreaTypeComponentProps) => {
  useSignals()
  const editor = useRef<HTMLDivElement>(null)
  const mergeView = useRef<MergeView>(null)
  const theValue = kclManager.history.entries.value
  const settings = useSettings()
  const applicationProjectDirectory = settings.app.projectDirectory.current
  const { kclLSP } = useLspContext()

  return (
    <LayoutPanel
      title={props.layout.label}
      id={`${props.layout.id}-pane`}
      className="border-none"
    >
      <LayoutPanelHeader
        id={props.layout.id}
        icon="code"
        title={props.layout.label}
        onClose={props.onClose}
      />
      <div className="w-full h-full relative overflow-y-auto overflow-x-hidden">
        <div className="w-full h-full flex flex-col">
          <div className="overflow-auto pb-12 inset-0">
            {theValue.map((e) => {
              const path = parentPathRelativeToProject(
                e.absoluteFilePath,
                applicationProjectDirectory
              )
              return (
                <div
                  className="h-16"
                  onClick={() =>
                    setDiff(
                      editor,
                      mergeView,
                      e.absoluteFilePath,
                      e.left,
                      e.right,
                      kclLSP
                    )
                  }
                >
                  <h2>{path}</h2>
                  <p>{e.dateString}</p>
                </div>
              )
            })}
          </div>
        </div>
        <div ref={editor}></div>
      </div>
    </LayoutPanel>
  )
}
