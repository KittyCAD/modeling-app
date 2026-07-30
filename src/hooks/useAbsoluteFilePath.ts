import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'

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

  return PATHS.FILE + '/' + encodeURIComponent(executingPath)
}
