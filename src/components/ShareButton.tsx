import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { commandBarActor } from '@src/lib/singletons'
import { useHotkeys } from 'react-hotkeys-hook'
import { useKclContext } from '@src/lang/KclProvider'

const shareHotkey = 'mod+alt+s'
const onShareClick = () =>
  commandBarActor.send({
    type: 'Find and select command',
    data: { name: 'share-file-link', groupId: 'code' },
  })

/** Share Zoo link button shown in the upper-right of the modeling view */
export const ShareButton = () => {
  const platform = usePlatform()
  useHotkeys(shareHotkey, onShareClick, {
    scopes: ['modeling'],
  })

  const kclContext = useKclContext()
  const disabled = kclContext.ast.body.some((n) => n.type === 'ImportStatement')

  return (
    <button
      type="button"
      onClick={onShareClick}
      disabled={disabled}
      className="flex gap-1 items-center py-0 pl-0.5 pr-1.5 m-0 bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 border border-solid active:border-primary"
      data-testid="share-button"
    >
      <CustomIcon name="link" className="w-5 h-5" />
      <span className="max-xl:hidden flex-1">Share</span>
      <Tooltip
        position="bottom-right"
        contentClassName="max-w-none flex items-center gap-4"
      >
        <span className="flex-1">
          {disabled
            ? `Share links are not currently supported for multi-file assemblies`
            : `Share part via Zoo link`}
        </span>
        {!disabled && (
          <kbd className="hotkey text-xs capitalize">
            {hotkeyDisplay(shareHotkey, platform)}
          </kbd>
        )}
      </Tooltip>
    </button>
  )
}
