import { useApp } from '@src/lib/boot'
import { useSelector } from '@xstate/react'

export const useRequestedProjectName = () => {
  const { systemIOActor } = useApp()
  return useSelector(
    systemIOActor,
    (state) => state.context.requestedProjectName
  )
}
export const useRequestedFileName = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.requestedFileName)
}
export const useProjectDirectoryPath = () => {
  const { systemIOActor } = useApp()
  return useSelector(
    systemIOActor,
    (state) => state.context.projectDirectoryPath
  )
}
export const useFolders = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.folders)
}
export const useState = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state)
}
export const useCanReadWriteProjectDirectory = () => {
  const { systemIOActor } = useApp()
  return useSelector(
    systemIOActor,
    (state) => state.context.canReadWriteProjectDirectory
  )
}
export const useHasListedProjects = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.hasListedProjects)
}

export const useLastOperation = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.lastOperation)
}

export const useClearURLParams = () => {
  const { systemIOActor } = useApp()
  return useSelector(systemIOActor, (state) => state.context.clearURLParams)
}
