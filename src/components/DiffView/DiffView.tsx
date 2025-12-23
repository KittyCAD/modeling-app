import { useEffect, useRef } from 'react'
import { MergeView, unifiedMergeView } from '@codemirror/merge'
import { EditorState } from '@codemirror/state'
import { dropCursor, EditorView, highlightActiveLine, highlightActiveLineGutter, highlightSpecialChars, lineNumbers, rectangularSelection } from '@codemirror/view'
import { kclManager } from '@src/lib/singletons'
import { useSignals } from '@preact/signals-react/runtime'
import { useSettings } from '@src/lib/singletons'
import { parentPathRelativeToProject } from '@src/lib/paths'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { AreaTypeComponentProps } from '@src/lib/layout'
import { lintGutter } from '@codemirror/lint'
import { bracketMatching, foldGutter } from '@codemirror/language'
import { highlightSelectionMatches } from '@codemirror/search'

async function setDiff(editorRef, mergeViewRef, absoluteFilePath, left, right) {
  const originalFile = await window.electron.readFile(absoluteFilePath, 'utf-8')
  if (mergeViewRef.current) {
    mergeViewRef.current.destroy()
  }
  const mergeView = new EditorView({
    parent: editorRef.current,
    doc: right,
    extensions: [
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
      unifiedMergeView({
        original: left,
        mergeControls: false
      })
    ]
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
                      e.right
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
