import { CustomIcon } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { useApp } from '@src/lib/boot'
import { reportRejection } from '@src/lib/trap'
import { saveViewportScreenshot } from './saveViewportScreenshot'

export function ScreenshotStatusBarItem() {
  const { fileOperations } = useApp()
  return (
    <button
      type="button"
      className={defaultStatusBarItemClassNames}
      aria-label="Capture screenshot"
      onClick={() => {
        saveViewportScreenshot(fileOperations).catch(reportRejection)
      }}
    >
      <CustomIcon name="camera" className="h-5 w-5 shrink-0" />
      <Tooltip hoverOnly={true} position="top-right">
        Capture screenshot
      </Tooltip>
    </button>
  )
}
