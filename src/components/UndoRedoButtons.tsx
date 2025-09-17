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
        disabled={!historySnapshot.canUndo}
      />
      <UndoOrRedoButton
        label={`Redo ${historySnapshot.currentStackId}`}
        keyboardShortcut="mod+shift+z"
        iconName="arrowRotateRight"
        onClick={() => {
          historyManager.undo().catch((e) => console.error('failed to undo', e))
        }}
        disabled={!historySnapshot.canRedo}
      />
    </div>
  )
}

interface UndoOrRedoButtonProps {
  label: string
  onClick: MouseEventHandler
  iconName: 'arrowRotateRight' | 'arrowRotateLeft'
  keyboardShortcut: string
  disabled: boolean
}

function UndoOrRedoButton(props: UndoOrRedoButtonProps) {
  const platform = usePlatform()
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="p-0 m-0 border-transparent dark:border-transparent focus-visible:border-chalkboard-100 disabled:text-3 disabled:cursor-not-allowed"
      disabled={props.disabled}
    >
      <CustomIcon name={props.iconName} className="w-6 h-6" />
      <Tooltip
        position="bottom"
        hoverOnly={true}
        contentClassName="text-sm max-w-none flex items-center gap-4"
      >
        <span>{props.label}</span>
        <kbd className="hotkey capitalize">
          {hotkeyDisplay(props.keyboardShortcut, platform)}
        </kbd>
      </Tooltip>
    </button>
  )
}
