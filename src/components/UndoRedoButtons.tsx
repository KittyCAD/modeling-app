import { redoDepth, undoDepth } from '@codemirror/commands'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type { KclManager } from '@src/lang/KclManager'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeys'
import { reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'
import type { HTMLProps, MouseEventHandler } from 'react'

export function UndoRedoButtons({
  kclManager,
  ...props
}: HTMLProps<HTMLDivElement> & { kclManager: KclManager }) {
  return (
    <div {...props}>
      <UndoOrRedoButton
        label="Undo"
        keyboardShortcut="mod+z"
        iconName="arrowTurnLeft"
        onClick={() => kclManager.undo()}
        className="rounded-r-none"
        disabled={undoDepth(kclManager.editorState) === 0}
      />
      <UndoOrRedoButton
        label="Redo"
        keyboardShortcut="mod+shift+z"
        iconName="arrowTurnRight"
        onClick={() => kclManager.redo()}
        className="rounded-none"
        disabled={redoDepth(kclManager.editorState) === 0}
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
  const platform = usePlatform()
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
          <kbd className="hotkey capitalize">
            {hotkeyDisplay(keyboardShortcut, platform)}
          </kbd>
        )}
      </Tooltip>
    </button>
  )
}
