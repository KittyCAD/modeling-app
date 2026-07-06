import { Menu } from '@headlessui/react'
import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import { LayoutPanel, LayoutPanelHeader } from '@src/components/layout/Panel'
import { HeaderMenu } from '@src/components/layout/Panel/HeaderMenu'
import usePlatform from '@src/hooks/usePlatform'
import { useConvertToVariable } from '@src/hooks/useToolbarGuards'
import { useApp, useSingletons } from '@src/lib/boot'
import type { AreaTypeComponentProps } from '@src/lib/layout'
import { openExternalBrowserIfDesktop } from '@src/lib/openWindow'
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
  const { kclManager } = useSingletons()
  const editorParent = useRef<HTMLDivElement>(null)
  useEffect(() => {
    editorParent.current?.appendChild(kclManager.editorView.dom)
  }, [kclManager.editorView.dom])

  return (
    <div className="relative">
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
