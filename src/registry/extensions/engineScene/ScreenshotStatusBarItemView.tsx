import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'
import type { ViewportScreenshotService } from '@src/registry/contracts/viewportScreenshot'
import { CustomIcon } from '@src/components/CustomIcon'
import { defaultStatusBarItemClassNames } from '@src/components/StatusBar/StatusBar'
import Tooltip from '@src/components/Tooltip'
import { reportRejection } from '@src/lib/trap'
import { saveViewportScreenshot } from './saveViewportScreenshot'

export function ScreenshotStatusBarItemView({
  fileOperations,
  screenshot,
  disabled = false,
}: {
  fileOperations: FileOperationsRegistryService | undefined
  screenshot: ViewportScreenshotService
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={defaultStatusBarItemClassNames}
      aria-label="Capture screenshot"
      disabled={disabled || !fileOperations}
      onClick={() => {
        if (fileOperations)
          saveViewportScreenshot(fileOperations, screenshot).catch(
            reportRejection
          )
      }}
    >
      <CustomIcon name="camera" className="h-5 w-5 shrink-0" />
      <Tooltip hoverOnly={true} position="top-right">
        Capture screenshot
      </Tooltip>
    </button>
  )
}
