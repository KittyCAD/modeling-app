import { CustomIcon } from '@src/components/CustomIcon'
import Tooltip from '@src/components/Tooltip'
import { useMenuListener } from '@src/hooks/useMenu'
import usePlatform from '@src/hooks/usePlatform'
import { hotkeyDisplay } from '@src/lib/hotkeyWrapper'
import { reportRejection } from '@src/lib/trap'
import { refreshPage } from '@src/lib/utils'
import type { WebContentSendPayload } from '@src/menu/channels'

export const RefreshButton = () => {
  const platform = usePlatform()
  const cb = (data: WebContentSendPayload) => {
    if (data.menuLabel === 'Help.Refresh and report a bug') {
      refreshPage('Native menu').catch(reportRejection)
    }
  }
  useMenuListener(cb)

  return (
    <button
      type="button"
      onClick={() => {
        refreshPage().catch(reportRejection)
      }}
      className="p-1 m-0 bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 rounded-full border border-solid border-chalkboard-20 dark:border-chalkboard-90"
    >
      <CustomIcon name="arrowRotateRight" className="w-5 h-5" />
      <Tooltip
        position="bottom-right"
        contentClassName="max-w-none flex items-center gap-4"
      >
        <span className="flex-1">Refresh app</span>
        <kbd className="hotkey text-xs capitalize">
          {hotkeyDisplay('mod+r', platform)}
        </kbd>
      </Tooltip>
    </button>
  )
}
