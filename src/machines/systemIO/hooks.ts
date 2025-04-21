import { systemIOActor } from '@src/machines/appMachine'
import { useSelector } from '@xstate/react'
export const useRequestedProjectName = () =>
  useSelector(systemIOActor, (state) => state.context.requestedProjectName)
export const useRequestedFileName = () =>
  useSelector(systemIOActor, (state) => state.context.requestedFileName)
export const useProjectDirectoryPath = () =>
  useSelector(systemIOActor, (state) => state.context.projectDirectoryPath)
export const useFolders = () =>
  useSelector(systemIOActor, (state) => state.context.folders)
export const useState = () => useSelector(systemIOActor, (state) => state)
export const useCanReadWriteProjectDirectory = () =>
  useSelector(
    systemIOActor,
    (state) => state.context.canReadWriteProjectDirectory
  )
export const useHasListedProjects = () =>
  useSelector(systemIOActor, (state) => state.context.hasListedProjects)

export const useClearURLParams = () =>
  useSelector(systemIOActor, (state) => state.context.clearURLParams)
