import { defaultKeymap } from '@codemirror/commands'
import { searchKeymap } from '@codemirror/search'
import { EditorState } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view'
import { Menu } from '@headlessui/react'
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
} from '@src/lib/activeTextFile'
import { useApp, useSingletons } from '@src/lib/boot'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
import { getResolvedTheme } from '@src/lib/theme'
import { reportRejection, trap } from '@src/lib/trap'
import { withSiteBaseURL } from '@src/lib/withBaseURL'
import { useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import styles from './KclEditorMenu.module.css'

type Singletons = ReturnType<typeof useSingletons>

export const editorShortcutMeta = {
  formatCode: {
    display: 'Alt + Shift + F',
  },
  convertToVariable: {
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
  useSignals()
  const { kclManager } = useSingletons()
  const activeTextFile = activeTextFileSignal.value
  const editorParent = useRef<HTMLDivElement>(null)

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
    return <ReadOnlyTextFileEditor activeTextFile={activeTextFile} />
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

function ReadOnlyTextFileEditor({
  activeTextFile,
}: {
  activeTextFile: ActiveTextFile
}) {
  const { settings } = useApp()
  const settingsValues = settings.useSettings()
  const resolvedTheme = getResolvedTheme(settingsValues.app.theme.current)
  const editorParent = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editorParent.current || activeTextFile.status !== 'ready') {
      return
    }

    const editor = new EditorView({
      state: EditorState.create({
        doc: activeTextFile.text,
        extensions: [
          editorTheme[resolvedTheme],
          textFileEditorTheme,
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          EditorView.lineWrapping,
          drawSelection(),
          lineNumbers(),
          highlightSpecialChars(),
          highlightActiveLine(),
          keymap.of([...defaultKeymap, ...searchKeymap]),
        ],
      }),
      parent: editorParent.current,
    })

    return () => {
      editor.destroy()
    }
  }, [activeTextFile, resolvedTheme])

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
  const activeTextFile = activeTextFileSignal.value

  if (activeTextFile) {
    return null
  }

  return <KclEditorKclMenu />
}

const KclEditorKclMenu = () => {
  const { commands, settings } = useApp()
  const { kclManager } = useSingletons()
  const platform = usePlatform()
  const settingsActor = settings.actor
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
          <small>
            {hotkeyDisplay(editorShortcutMeta.formatCode.display, platform)}
          </small>
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
