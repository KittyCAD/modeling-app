import { useApp } from '@src/lib/boot'
import { getProjectFileUrl } from '@src/lib/projectNavigation'

const defaultOptions = {
  warnIfNoExecutingPath: true,
}

export function useAbsoluteFilePath(options = defaultOptions) {
  const app = useApp()

  const executingPath = app.project?.executingPathSignal.value?.value

  if (!executingPath) {
    if (options.warnIfNoExecutingPath) {
      console.warn('executingPath undefined but expected')
    }
    return
  }

  return (
    app.project &&
    getProjectFileUrl(app.project.projectIORefSignal.value, executingPath)
  )
}
