import { useApp } from '@src/lib/boot'
import { PATHS } from '@src/lib/paths'
import { projectSession } from '@src/registry/contracts/projectSession'
import { useSignals } from '@preact/signals-react/runtime'

const defaultOptions = {
  warnIfNoExecutingPath: true,
}

export function useAbsoluteFilePath(options = defaultOptions) {
  useSignals()

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
