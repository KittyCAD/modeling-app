import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type EditorManager from '@src/editor/manager'
import usePlatform from '@src/hooks/usePlatform'
import { useStack } from '@src/lib/history'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { historyManager } from '@src/lib/singletons'
import type { HTMLProps, MouseEventHandler } from 'react'

export function UndoRedoButtons({
  editorManager,
  ...props
}: HTMLProps<HTMLDivElement> & { editorManager: EditorManager }) {
  const s = useStack(historyManager)
  return (
    <div {...props}>
      <UndoOrRedoButton
        label="Undo"
        keyboardShortcut="mod+z"
        iconName="arrowRotateLeft"
        onClick={() => {
          if (s.canUndo) {
            historyManager
              .undo()
              .then(() => console.log('yayyyyy', historyManager))
              .catch((e) => console.error('nooooo', e))
            return
          }
          editorManager.undo()
        }}
        disabled={!s.canUndo}
      />
      <UndoOrRedoButton
        label="Redo"
        keyboardShortcut="mod+shift+z"
        iconName="arrowRotateRight"
        onClick={() => {
          if (s.canRedo) {
            historyManager
              .redo()
              .then(() => console.log('yayyyyy'))
              .catch((e) => console.error('nooooo', e))
            return
          }
          editorManager.redo()
        }}
        disabled={!s.canRedo}
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
