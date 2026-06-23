import { useSignals } from '@preact/signals-react/runtime'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import type { KclManager } from '@src/lang/KclManager'
import { useApp } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'
import {
  findKeymapItemForCommand,
  keymapKeystrokesDisplay,
  keymapScopesValueSpec,
  keymapService,
} from '@src/registry/contracts/keymap'
import { APP_COMMAND_IDS } from '@src/registry/extensions/commands/appCommands'
import { type HTMLProps, type MouseEventHandler } from 'react'

export function UndoRedoButtons({
  kclManager,
  ...props
}: HTMLProps<HTMLDivElement> & { kclManager: KclManager }) {
  useSignals()
  const app = useApp()
  const platform = usePlatform()
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

  return (
    <div {...props}>
      <UndoOrRedoButton
        label="Undo"
        keyboardShortcut={keybindingDisplay(APP_COMMAND_IDS.editor.undo, [
          'mod+z',
        ])}
        iconName="arrowTurnLeft"
        onClick={() => kclManager.undo()}
        className="rounded-r-none"
        disabled={
          kclManager.undoDepth.value === 0 ||
          kclManager.historyOperationInProgress.value
        }
      />
      <UndoOrRedoButton
        label="Redo"
        keyboardShortcut={keybindingDisplay(APP_COMMAND_IDS.editor.redo, [
          'mod+shift+z',
        ])}
        iconName="arrowTurnRight"
        onClick={() => kclManager.redo()}
        className="rounded-none"
        disabled={
          kclManager.redoDepth.value === 0 ||
          kclManager.historyOperationInProgress.value
        }
      />
      {/** TODO: Remove the refresh button when users don't need it so much. */}
      <UndoOrRedoButton
        label="Reload"
        iconName="arrowRotateFullRight"
        onClick={() => {
          refreshPage('Top app bar').catch(reportRejection)
        }}
        className="rounded-l-none"
        disabled={false}
      />
    </div>
  )
}

interface UndoOrRedoButtonProps extends HTMLProps<HTMLButtonElement> {
  label: string
  onClick: MouseEventHandler
  iconName: 'arrowTurnRight' | 'arrowTurnLeft' | 'arrowRotateFullRight'
  keyboardShortcut?: string
  disabled: boolean
}

function UndoOrRedoButton({
  onClick,
  disabled,
  iconName,
  label,
  keyboardShortcut,
  className,
  ...rest
}: UndoOrRedoButtonProps) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onClick}
      className={`p-0 m-0 border-transparent dark:border-transparent focus-visible:b-default disabled:bg-transparent dark:disabled:bg-transparent disabled:border-transparent dark:disabled:border-transparent disabled:text-4 ${className}`}
      disabled={disabled}
    >
      <CustomIcon name={iconName} className="w-6 h-6" />
      <Tooltip
        position="bottom"
        hoverOnly={true}
        contentClassName="text-sm max-w-none flex items-center gap-4"
      >
        <span>{label}</span>
        {keyboardShortcut && (
          <kbd className="hotkey capitalize">{keyboardShortcut}</kbd>
        )}
      </Tooltip>
    </button>
  )
}
