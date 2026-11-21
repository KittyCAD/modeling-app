import { useApp } from '@src/lib/boot'
import { viewportScreenshotService } from '@src/registry/contracts/viewportScreenshot'
import { ScreenshotStatusBarItemView } from './ScreenshotStatusBarItemView'
export function ScreenshotStatusBarItem() {
  const { fileOperations, registry } = useApp()
  return (
    <ScreenshotStatusBarItemView
      fileOperations={fileOperations}
      screenshot={registry.required(viewportScreenshotService)}
    />
  )
}
