import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import type EditorManager from '@src/editor/manager'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import type { HTMLProps, MouseEventHandler } from 'react'

export function UndoRedoButtons({
  editorManager,
  ...props
}: HTMLProps<HTMLDivElement> & { editorManager: EditorManager }) {
  return (
    <div {...props}>
      <UndoOrRedoButton
        label="Undo"
        keyboardShortcut="mod+z"
        iconName="arrowRotateLeft"
        onClick={() => editorManager.undo()}
      />
      <UndoOrRedoButton
        label="Redo"
        keyboardShortcut="mod+shift+z"
        iconName="arrowRotateRight"
        onClick={() => editorManager.redo()}
      />
    </div>
  )
}

interface UndoOrRedoButtonProps {
  label: string
  onClick: MouseEventHandler
  iconName: 'arrowRotateRight' | 'arrowRotateLeft'
  keyboardShortcut: string
}

function UndoOrRedoButton(props: UndoOrRedoButtonProps) {
  const platform = usePlatform()
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="p-0 m-0 border-transparent dark:border-transparent focus-visible:border-chalkboard-100"
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
