import { redoDepth, undoDepth } from '@codemirror/commands'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import type { HistoryService } from '@src/lib/history'
import { useHistory } from '@src/lib/history/lib'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { useEffect, type HTMLProps, type MouseEventHandler } from 'react'

export function UndoRedoButtons({
  historyManager,
  ...props
}: HTMLProps<HTMLDivElement> & { historyManager: HistoryService }) {
  const historySnapshot = useHistory(historyManager)
  useEffect(
    () => console.log('FRANK new snapshot', historySnapshot),
    [historySnapshot]
  )
  return (
    <div {...props}>
      <UndoOrRedoButton
        label={`Undo ${historySnapshot.currentStackId}`}
        keyboardShortcut="mod+z"
        iconName="arrowRotateLeft"
        onClick={() => {
          historyManager.undo().catch((e) => console.error('failed to undo', e))
        }}
        className="rounded-r-none"
        disabled={!historySnapshot.canUndo}
      />
      <UndoOrRedoButton
        label={`Redo ${historySnapshot.currentStackId}`}
        keyboardShortcut="mod+shift+z"
        iconName="arrowRotateRight"
        onClick={() => {
          historyManager.undo().catch((e) => console.error('failed to undo', e))
        }}
        className="rounded-l-none"
        disabled={!historySnapshot.canRedo}
      />
    </div>
  )
}

interface UndoOrRedoButtonProps extends HTMLProps<HTMLButtonElement> {
  label: string
  onClick: MouseEventHandler
  iconName: 'arrowRotateRight' | 'arrowRotateLeft'
  keyboardShortcut: string
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
        <kbd className="hotkey capitalize">
          {hotkeyDisplay(keyboardShortcut, platform)}
        </kbd>
      </Tooltip>
    </button>
  )
}
