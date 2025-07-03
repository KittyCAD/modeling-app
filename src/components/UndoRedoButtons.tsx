import type EditorManager from '@src/editor/manager'
import usePlatform from '@src/hooks/usePlatform'
import type { HTMLProps } from 'react'
import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'

export function UndoRedoButtons({
  editorManager,
  ...props
}: HTMLProps<HTMLDivElement> & { editorManager: EditorManager }) {
  const platform = usePlatform()

  return (
    <div {...props}>
      <button
        type="button"
        onClick={() => editorManager.undo()}
        className="p-0 border-transparent dark:border-transparent focus-visible:border-chalkboard-100"
      >
        <CustomIcon name="arrowRotateLeft" className="w-6 h-6" />
        <Tooltip
          position="bottom"
          contentClassName="text-sm max-w-none flex items-center gap-4"
        >
          <span>Undo</span>
          <kbd className="hotkey capitalize">
            {hotkeyDisplay('mod+z', platform)}
          </kbd>
        </Tooltip>
      </button>
      <button
        type="button"
        onClick={() => editorManager.redo()}
        className="p-0 border-transparent dark:border-transparent focus-visible:border-chalkboard-100"
      >
        <CustomIcon name="arrowRotateRight" className="w-6 h-6" />
        <Tooltip
          position="bottom"
          contentClassName="text-sm max-w-none flex items-center gap-4"
        >
          <span>Redo</span>
          <kbd className="hotkey capitalize">
            {hotkeyDisplay('mod+shift+z', platform)}
          </kbd>
        </Tooltip>
      </button>
    </div>
  )
}
