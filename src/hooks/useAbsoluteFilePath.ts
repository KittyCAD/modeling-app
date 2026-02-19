import { BROWSER_PATH, PATHS } from '@src/lib/paths'
import { useApp } from '@src/lib/boot'
import { useSignals } from '@preact/signals-react/runtime'

export function useAbsoluteFilePath() {
  useSignals()
  const app = useApp()

  return (
    PATHS.FILE +
    '/' +
    encodeURIComponent(
      app.project.value?.executingPathSignal.value ?? BROWSER_PATH
    )
  )
}
