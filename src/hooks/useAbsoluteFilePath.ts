import { PATHS } from '@src/lib/paths'
import { useApp } from '@src/lib/boot'

export function useAbsoluteFilePath() {
  const app = useApp()

  if (!routeData?.file) {
    return undefined
  }

  return app.project?.executingPathSignal.value?.value
}
