import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'

export function useAbsoluteFilePath() {
  const app = useApp()

  const executingPath = app.project?.executingPathSignal.value?.value
  const projectPath = app.project?.path
  const targetPath = executingPath ?? projectPath

  if (!targetPath) {
    return
  }

  return PATHS.FILE + '/' + encodeURIComponent(targetPath)
}
