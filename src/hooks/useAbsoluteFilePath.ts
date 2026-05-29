import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'

export function useAbsoluteFilePath() {
  const app = useApp()

  const executingPath = app.project?.executingPathSignal.value?.value

  if (!executingPath) {
    console.warn('bug: executingPath undefined, not navigating')
    return
  }

  return PATHS.FILE + '/' + encodeURIComponent(executingPath)
}
