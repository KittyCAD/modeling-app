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
import {
  parentPathRelativeToApplicationDirectory,
  parentPathRelativeToProject,
} from '@src/lib/paths'
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
import { CustomIcon } from '@src/components/CustomIcon'

function timeSince(date) {
  const seconds = Math.floor((new Date() - date) / 1000)
  let interval = seconds / 31536000
  if (interval > 1) {
    return Math.floor(interval) + ' years'
  }
  interval = seconds / 2592000
  if (interval > 1) {
    return Math.floor(interval) + ' months'
  }
  interval = seconds / 86400
  if (interval > 1) {
    return Math.floor(interval) + ' days'
  }
  interval = seconds / 3600
  if (interval > 1) {
    return Math.floor(interval) + ' hours'
  }
  interval = seconds / 60
  if (interval > 1) {
    return Math.floor(interval) + ' minutes'
  }
  return Math.floor(seconds) + ' seconds'
}

export const HistoryView = (props: AreaTypeComponentProps) => {
  useSignals()
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
              const projectPath = parentPathRelativeToApplicationDirectory(
                e.absoluteFilePath,
                applicationProjectDirectory
              )
              const outlineCSS = false
                ? 'outline outline-1 outline-primary'
                : 'outline-0 outline-none'
              const isSelected = false
              const month = e.date.toLocaleString('default', { month: 'long' })
              const dayOfMonth = e.date.getDate()
              const year = e.date.getFullYear()
              return (
                <div
                  className={`px-2 h-5 flex flex-row items-center justify-between text-xs cursor-pointer -outline-offset-1 ${outlineCSS} hover:outline hover:outline-1 hover:bg-gray-300/50 hover:bg-gray-300/50 ${isSelected ? 'bg-primary/10' : ''}`}
                  onClick={() =>
                    (kclManager.history.lastEntrySelected.value = e)
                  }
                >
                  <div className="flex flex-row items-center">
                    <CustomIcon
                      name="kcl"
                      className="inline-block w-4 text-current mr-1"
                    />
                    <span className="pr-2">{path}</span>
                    <span className="text-xs text-chalkboard-80 dark:text-chalkboard-30 ">
                      {projectPath}
                    </span>
                  </div>
                  <span>
                    {timeSince(e.date)} ago ({month} {dayOfMonth}, {year} at{' '}
                    {e.date.toLocaleTimeString()})
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </LayoutPanel>
  )
}
