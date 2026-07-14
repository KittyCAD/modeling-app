import { Menu } from '@headlessui/react'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown } from '@codemirror/lang-markdown'
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { searchKeymap } from '@codemirror/search'
import { Compartment, EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import { editorTheme } from '@src/editor/plugins/theme'
import usePlatform from '@src/hooks/usePlatform'
import { useConvertToVariable } from '@src/hooks/useToolbarGuards'
import {
  type ActiveTextFile,
  activeTextFileSignal,
  clearActiveTextFile,
  flushActiveTextFileWrite,
  scheduleActiveTextFileWrite,
} from '@src/lib/activeTextFile'
import { useApp, useSingletons } from '@src/lib/boot'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { getResolvedTheme } from '@src/lib/theme'
import { reportRejection, trap } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import styles from './KclEditorMenu.module.css'

type Singletons = ReturnType<typeof useSingletons>

export const editorShortcutMeta = {
  formatCode: {
    defaultKeys: ['alt+shift+f'],
  },
  convertToVariable: {
    defaultKeys: ['ctrl+shift+c'],
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
  useSignals()
  const { kclManager } = useSingletons()
  const activeTextFile = activeTextFileSignal.value
  const editorParent = useRef<HTMLDivElement>(null)

  // When this pane unmounts (e.g. the Code pane is closed), stop showing the
  // text file so a KCL file is shown again the next time it opens.
  useEffect(() => {
    return () => {
      clearActiveTextFile()
    }
  }, [])

  useEffect(() => {
    if (activeTextFile) {
      return
    }
    editorParent.current?.appendChild(kclManager.editorView.dom)
  }, [activeTextFile, kclManager.editorView.dom])

  if (activeTextFile) {
    return <TextFileEditor activeTextFile={activeTextFile} />
  }

  return (
    <div className="relative h-full">
      <div
        id="code-mirror-override"
        className="absolute inset-0 pr-1"
        ref={editorParent}
      />
    </div>
  )
}

const textFileEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    color: 'inherit',
  },
  '.cm-scroller': {
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
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

/** Compartment so theme changes reconfigure in place instead of recreating the view. */
const textThemeCompartment = new Compartment()

/**
 * A lightweight, editable CodeMirror surface for non-KCL text files (Markdown /
 * plain text). It is deliberately independent of `KclManager` so editing these
 * files never triggers KCL execution, LSP, or WASM project loading. Edits are
 * auto-saved to disk (debounced) via {@link scheduleActiveTextFileWrite}.
 */
function TextFileEditor({
  activeTextFile,
}: {
  activeTextFile: ActiveTextFile
}) {
  const { settings } = useApp()
  const settingsValues = settings.useSettings()
  const resolvedTheme = getResolvedTheme(settingsValues.app.theme.current)
  const editorParent = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  // Create/destroy the editor only when the FILE changes (path/status) — never
  // on keystroke or theme change, which would reset cursor/scroll and could
  // drop un-flushed edits.
  useEffect(() => {
    if (!editorParent.current || activeTextFile.status !== 'ready') {
      return
    }
    const path = activeTextFile.path
    const languageExtension = path.toLowerCase().endsWith('.md')
      ? [
          markdown(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        ]
      : []

    const view = new EditorView({
      state: EditorState.create({
        doc: activeTextFile.text,
        extensions: [
          textThemeCompartment.of(editorTheme[resolvedTheme]),
          textFileEditorTheme,
          ...languageExtension,
          EditorView.lineWrapping,
          history(),
          drawSelection(),
          lineNumbers(),
          highlightSpecialChars(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              scheduleActiveTextFileWrite(path, update.state.doc.toString())
            }
          }),
        ],
      }),
      parent: editorParent.current,
    })
    viewRef.current = view

    return () => {
      view.destroy()
      viewRef.current = null
      // Persist edits typed within the debounce window before switching away.
      flushActiveTextFileWrite().catch(reportRejection)
    }
    // resolvedTheme is intentionally omitted: theme changes are handled by the
    // compartment effect below so the editor isn't recreated on every toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTextFile.path, activeTextFile.status])

  // Reconfigure the theme in place — no recreation, no lost edits.
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: textThemeCompartment.reconfigure(editorTheme[resolvedTheme]),
    })
  }, [resolvedTheme])

  if (activeTextFile.status === 'loading') {
    return (
      <div className="h-full p-3 text-sm text-chalkboard-70 dark:text-chalkboard-30">
        Loading {activeTextFile.name}...
      </div>
    )
  }

  if (activeTextFile.status === 'error') {
    return (
      <div className="h-full p-3 text-sm text-destroy-80">
        Failed to open {activeTextFile.name}: {activeTextFile.error}
      </div>
    )
  }

  return (
    <div className="relative h-full">
      <div
        id="code-mirror-override"
        className="absolute inset-0 pr-1"
        ref={editorParent}
      />
    </div>
  )
}

function copyKclCodeToClipboard(kclManager: Singletons['kclManager']) {
  if (!kclManager.codeSignal.value) {
    toast.error('No code available to copy.')
    return
  }

  if (!globalThis?.navigator?.clipboard?.writeText) {
    toast.error('Clipboard functionality not available in your browser.')
    return
  }

  navigator.clipboard
    .writeText(kclManager.codeSignal.value)
    .then(() => toast.success(`Copied current file's code to clipboard.`))
    .catch((e) =>
      trap(new Error(`Failed to copy code to clipboard: ${e.message}`))
    )
}

export const KclEditorMenu = () => {
  useSignals()
  // The KCL-specific menu items (format, convert to variable, KCL docs, add KCL
  // file) don't apply when a plain text/markdown file is open in the pane.
  if (activeTextFileSignal.value) {
    return null
  }
  return <KclEditorKclMenu />
}

const KclEditorKclMenu = () => {
  useSignals()
  const app = useApp()
  const { commands, settings } = app
  const { kclManager } = useSingletons()
  const platform = usePlatform()
  const settingsActor = settings.actor
  const keymap = app.registry.optional(keymapService)
  const keymapScopes = app.registry.signal(keymapScopesValueSpec).value
  const currentScopes = keymap?.getCurrentScopes()
  const keybindingDisplay = (
    command: string,
    fallbackKeystrokes: readonly string[]
  ) =>
    keymapKeystrokesDisplay(
      keymap && currentScopes
        ? findKeymapItemForCommand(
            keymap.keymap.value,
            command,
            currentScopes,
            keymapScopes
          )?.keystrokes
        : fallbackKeystrokes,
      platform
    )
  const formatCodeKeybinding = keybindingDisplay(
    APP_COMMAND_IDS.editor.format,
    editorShortcutMeta.formatCode.defaultKeys
  )
  const convertToVariableKeybinding = keybindingDisplay(
    APP_COMMAND_IDS.editor.convertToVariable,
    editorShortcutMeta.convertToVariable.defaultKeys
  )
  const { enable: convertToVarEnabled, handleClick: handleConvertToVarClick } =
    useConvertToVariable(kclManager)

  return (
    <HeaderMenu>
      <Menu.Item>
        <button
          type="button"
          onClick={() => {
            kclManager.format().catch(reportRejection)
          }}
          className={styles.button}
        >
          <span>Format code</span>
          {formatCodeKeybinding && <small>{formatCodeKeybinding}</small>}
        </button>
      </Menu.Item>
      <Menu.Item>
        <button
          type="button"
          onClick={() => copyKclCodeToClipboard(kclManager)}
          className={styles.button}
        >
          <span>Copy code</span>
        </button>
      </Menu.Item>
      {convertToVarEnabled && (
        <Menu.Item>
          <button
            type="button"
            onClick={() => {
              handleConvertToVarClick().catch(reportRejection)
            }}
            className={styles.button}
          >
            <span>Convert to Variable</span>
            {convertToVariableKeybinding && (
              <small>{convertToVariableKeybinding}</small>
            )}
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
          type="button"
          onClick={() => {
            const currentProject =
              settingsActor.getSnapshot().context.currentProject
            commands.send({
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
    </HeaderMenu>
  )
}
