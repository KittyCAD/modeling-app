import { redoDepth, undoDepth } from '@codemirror/commands'
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
        className="rounded-r-none"
        disabled={undoDepth(editorManager.editorState) === 0}
      />
      <UndoOrRedoButton
        label="Redo"
        keyboardShortcut="mod+shift+z"
        iconName="arrowRotateRight"
        onClick={() => editorManager.redo()}
        className="rounded-l-none"
        disabled={redoDepth(editorManager.editorState) === 0}
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
