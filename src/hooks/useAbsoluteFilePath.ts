import { BROWSER_PATH, PATHS } from '@src/lib/paths'
import { useApp } from '@src/lib/boot'

export function useAbsoluteFilePath() {
  const app = useApp()

  return (
    PATHS.FILE +
    '/' +
    encodeURIComponent(
      app.project?.executingPathSignal.value?.value ?? BROWSER_PATH
    )
  )
}
