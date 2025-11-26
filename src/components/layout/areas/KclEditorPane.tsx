import { Menu } from '@headlessui/react'
import type { PropsWithChildren } from 'react'
import { ActionIcon } from '@src/components/ActionIcon'
import { useConvertToVariable } from '@src/hooks/useToolbarGuards'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { commandBarActor, settingsActor } from '@src/lib/singletons'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import toast from 'react-hot-toast'
import styles from './KclEditorMenu.module.css'
import {
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
} from '@codemirror/commands'
import {
  bracketMatching,
  codeFolding,
  foldGutter,
  foldKeymap,
  indentOnInput,
} from '@codemirror/language'
import { diagnosticCount, lintGutter, lintKeymap } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import type { Extension } from '@codemirror/state'
import { EditorState, Prec, Transaction } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'
import interact from '@replit/codemirror-interact'
import { useSelector } from '@xstate/react'
import { useEffect, useMemo, useRef } from 'react'
import { useLspContext } from '@src/components/LspProvider'
import CodeEditor from '@src/components/layout/areas/CodeEditor'
import { historyCompartment } from '@src/editor/compartments'
import { lineHighlightField } from '@src/editor/highlightextension'
import { modelingMachineEvent } from '@src/editor/manager'
import { codeManager, editorManager, kclManager } from '@src/lib/singletons'
import { useSettings } from '@src/lib/singletons'
import { Themes, getSystemTheme } from '@src/lib/theme'
import { reportRejection, trap } from '@src/lib/trap'
import { onMouseDragMakeANewNumber, onMouseDragRegex } from '@src/lib/utils'
import {
  editorIsMountedSelector,
  kclEditorActor,
  selectionEventSelector,
} from '@src/machines/kclEditorMachine'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { kclSyntaxHighlightingExtension } from '@src/lib/codeEditor'
import { CustomIcon } from '@src/components/CustomIcon'

export const editorShortcutMeta = {
  formatCode: {
    display: 'Alt + Shift + F',
  },
  convertToVariable: {
    codeMirror: 'Ctrl-Shift-c',
    display: 'Ctrl + Shift + C',
  },
}

export const KclEditorPane = (props: AreaTypeComponentProps) => {
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
        Menu={KclEditorMenu}
        onClose={props.onClose}
      />
      <KclEditorPaneContents />
    </LayoutPanel>
  )
}

export const KclEditorPaneContents = () => {
  const context = useSettings()
  const lastSelectionEvent = useSelector(kclEditorActor, selectionEventSelector)
  const editorIsMounted = useSelector(kclEditorActor, editorIsMountedSelector)
  const theme =
    context.app.theme.current === Themes.System
      ? getSystemTheme()
      : context.app.theme.current
  const { copilotLSP, kclLSP } = useLspContext()

  // When this component unmounts, we need to tell the machine that the editor
  useEffect(() => {
    return () => {
      kclEditorActor.send({ type: 'setKclEditorMounted', data: false })
      kclEditorActor.send({ type: 'setLastSelectionEvent', data: undefined })
      kclManager.diagnostics = []
    }
  }, [])

  useEffect(() => {
    const editorView = editorManager.getEditorView()
    if (!editorIsMounted || !lastSelectionEvent || !editorView) {
      return
    }

    try {
      editorView.dispatch({
        selection: lastSelectionEvent.codeMirrorSelection,
        annotations: [modelingMachineEvent, Transaction.addToHistory.of(false)],
        scrollIntoView: lastSelectionEvent.scrollIntoView,
      })
    } catch (e) {
      console.error('Error setting selection', e)
    }
  }, [editorIsMounted, lastSelectionEvent])

  const textWrapping = context.textEditor.textWrapping
  const cursorBlinking = context.textEditor.blinkingCursor
  // DO NOT ADD THE CODEMIRROR HOTKEYS HERE TO THE DEPENDENCY ARRAY
  // It reloads the editor every time we do _anything_ in the editor
  // I have no idea why.
  // Instead, hot load hotkeys via code mirror native.
  const codeMirrorHotkeys = codeManager.getCodemirrorHotkeys()

  // When opening the editor, use the existing history in editorManager.
  // This is needed to ensure users can undo beyond when the editor has been openeed.
  // (Another solution would be to reuse the same state instead of creating a new one in CodeEditor.)
  const existingHistory = editorManager.editorState.field(historyField)
  const initialHistory = existingHistory
    ? historyField.init(() => existingHistory)
    : history()

  const editorExtensions = useMemo(() => {
    const extensions = [
      drawSelection({
        cursorBlinkRate: cursorBlinking.current ? 1200 : 0,
      }),
      lineHighlightField,
      historyCompartment.of(initialHistory),
      closeBrackets(),
      codeFolding(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...searchKeymap,
        ...historyKeymap,
        ...foldKeymap,
        ...completionKeymap,
        ...lintKeymap,
        indentWithTab,
        ...codeMirrorHotkeys,
        {
          key: editorShortcutMeta.convertToVariable.codeMirror,
          run: () => {
            return editorManager.convertToVariable()
          },
        },
      ]),
    ] as Extension[]

    if (kclLSP) extensions.push(Prec.highest(kclLSP))
    if (copilotLSP) extensions.push(copilotLSP)

    extensions.push(
      lintGutter(),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightSpecialChars(),
      foldGutter(),
      EditorState.allowMultipleSelections.of(true),
      indentOnInput(),
      bracketMatching(),
      closeBrackets(),
      highlightActiveLine(),
      highlightSelectionMatches(),
      kclSyntaxHighlightingExtension,
      rectangularSelection(),
      dropCursor(),
      interact({
        rules: [
          // a rule for a number dragger
          {
            // the regexp matching the value
            regexp: onMouseDragRegex,
            // set cursor to "ew-resize" on hover
            cursor: 'ew-resize',
            // change number value based on mouse X movement on drag
            onDrag: (text, setText, e) => {
              onMouseDragMakeANewNumber(text, setText, e)
            },
          },
        ],
      })
    )
    if (textWrapping.current) extensions.push(EditorView.lineWrapping)

    return extensions
    // eslint-disable-next-line react-hooks/exhaustive-deps -- TODO: blanket-ignored fix me!
  }, [kclLSP, copilotLSP, textWrapping.current, cursorBlinking.current])

  const initialCode = useRef(codeManager.code)

  return (
    <div className="relative">
      <div
        id="code-mirror-override"
        className={
          'absolute inset-0 pr-1 ' + (cursorBlinking.current ? 'blink' : '')
        }
      >
        <CodeEditor
          initialDocValue={initialCode.current}
          extensions={editorExtensions}
          theme={theme}
          onCreateEditor={(_editorView) => {
            editorManager.setEditorView(_editorView)

            if (!_editorView) return

            // Update diagnostics as they are cleared when the editor is unmounted.
            // Without this, errors would not be shown when closing and reopening the editor.
            kclManager
              .safeParse(codeManager.code)
              .then(() => {
                // On first load of this component, ensure we show the current errors
                // in the editor.
                // Make sure we don't add them twice.
                if (diagnosticCount(_editorView.state) === 0) {
                  kclManager.setDiagnosticsForCurrentErrors()
                }
              })
              .catch(reportRejection)
          }}
        />
      </div>
    </div>
  )
}

function copyKclCodeToClipboard() {
  if (!codeManager.code) {
    toast.error('No code available to copy')
    return
  }

  if (!globalThis?.navigator?.clipboard?.writeText) {
    toast.error('Clipboard functionality not available in your browser')
    return
  }

  navigator.clipboard
    .writeText(codeManager.code)
    .then(() => toast.success(`Copied current file's code to clipboard`))
    .catch((e) =>
      trap(new Error(`Failed to copy code to clipboard: ${e.message}`))
    )
}

export const KclEditorMenu = ({ children }: PropsWithChildren) => {
  const { enable: convertToVarEnabled, handleClick: handleConvertToVarClick } =
    useConvertToVariable()

  return (
    <Menu>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions */}
      <div
        className="relative"
        onClick={(e) => {
          const target = e.target as HTMLElement
          if (e.eventPhase === 3 && target.closest('a') === null) {
            e.stopPropagation()
            e.preventDefault()
          }
        }}
      >
        <Menu.Button className="!p-0 !bg-transparent hover:text-primary border-transparent dark:!border-transparent hover:!border-primary dark:hover:!border-chalkboard-70 ui-open:!border-primary dark:ui-open:!border-chalkboard-70 !outline-none">
          <ActionIcon
            icon="three-dots"
            className="p-1"
            size="sm"
            bgClassName="bg-transparent dark:bg-transparent"
            iconClassName={'!text-chalkboard-90 dark:!text-chalkboard-40'}
          />
        </Menu.Button>
        <Menu.Items className="absolute right-0 left-auto w-72 flex flex-col gap-1 divide-y divide-chalkboard-20 dark:divide-chalkboard-70 align-stretch px-0 py-1 bg-chalkboard-10 dark:bg-chalkboard-100 rounded-sm shadow-lg border border-solid border-chalkboard-20/50 dark:border-chalkboard-80/50">
          <Menu.Item>
            <button
              onClick={() => {
                kclManager.format().catch(reportRejection)
              }}
              className={styles.button}
            >
              <span>Format code</span>
              <small>{editorShortcutMeta.formatCode.display}</small>
            </button>
          </Menu.Item>
          <Menu.Item>
            <button onClick={copyKclCodeToClipboard} className={styles.button}>
              <span>Copy code</span>
            </button>
          </Menu.Item>
          {convertToVarEnabled && (
            <Menu.Item>
              <button
                onClick={() => {
                  handleConvertToVarClick().catch(reportRejection)
                }}
                className={styles.button}
              >
                <span>Convert to Variable</span>
                <small>{editorShortcutMeta.convertToVariable.display}</small>
              </button>
            </Menu.Item>
          )}
          <Menu.Item>
            <a
              className={styles.button}
              href={withSiteBaseURL('/docs/kcl-lang')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternalBrowserIfDesktop()}
            >
              <span>Read the KCL docs</span>
              <small>
                zoo.dev
                <CustomIcon
                  name="link"
                  className="inline-block ml-1 text-align-top w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
                />
              </small>
            </a>
          </Menu.Item>
          <Menu.Item>
            <button
              onClick={() => {
                const currentProject =
                  settingsActor.getSnapshot().context.currentProject
                commandBarActor.send({
                  type: 'Find and select command',
                  data: {
                    name: 'add-kcl-file-to-project',
                    groupId: 'application',
                    argDefaultValues: {
                      method: 'existingProject',
                      projectName: currentProject?.name,
                    },
                  },
                })
              }}
              className={styles.button}
            >
              <span>Add file to project</span>
            </button>
          </Menu.Item>
          <Menu.Item>
            <a
              className={styles.button}
              href={withSiteBaseURL('/docs/kcl-samples')}
              target="_blank"
              rel="noopener noreferrer"
              onClick={openExternalBrowserIfDesktop()}
            >
              <span>View all samples</span>
              <small>
                zoo.dev
                <CustomIcon
                  name="link"
                  className="inline-block ml-1 text-align-top w-3 h-3 text-chalkboard-70 dark:text-chalkboard-40"
                />
              </small>
            </a>
          </Menu.Item>
        </Menu.Items>
      </div>
    </Menu>
  )
}
