import { CustomIcon } from './CustomIcon'
import Tooltip from './Tooltip'

export function RefreshButton() {
  function refresh() {
    // Window may not be available in some environments
    window?.location.reload()
  }

  return (
    <button
      onClick={refresh}
      className="p-1 m-0 bg-chalkboard-10/80 dark:bg-chalkboard-100/50 hover:bg-chalkboard-10 dark:hover:bg-chalkboard-100 rounded-full border border-solid border-chalkboard-10 dark:border-chalkboard-100"
    >
      <CustomIcon name="arrowRotateRight" className="w-5 h-5" />
      <Tooltip position="bottom-right">
        <span>Refresh and report</span>
        <br />
        <span className="text-xs">Send us data on how you got stuck</span>
      </Tooltip>
    </button>
  )
}
