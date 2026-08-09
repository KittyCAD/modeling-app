import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import { projectSession } from '@src/registry/contracts/projectSession'

const defaultOptions = {
  warnIfNoExecutingPath: true,
}

export function useAbsoluteFilePath(options = defaultOptions) {
  const app = useApp()
  const session = app.registry.get(projectSession)

  const executingPath = session.project.value?.executingPathSignal.value?.value

  if (!executingPath) {
    if (options.warnIfNoExecutingPath) {
      console.warn('executingPath undefined but expected')
    }
    return
  }

  return PATHS.FILE + '/' + encodeURIComponent(executingPath)
}
