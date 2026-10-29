import { useSignals } from '@preact/signals-react/runtime'
import { useApp } from '@src/lib/boot'
export const useRequestedProjectName = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.requestedProjectName
}
export const useRequestedFileName = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.requestedFileName
}
export const useProjectDirectoryPath = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.projectDirectoryPath
}
export const useFolders = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.folders
}
export const useCanReadWriteProjectDirectory = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.canReadWriteProjectDirectory
}
export const useHasListedProjects = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.hasListedProjects
}
export const useLastOperation = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.lastOperation
}
export const useClearURLParams = () => {
  useSignals()
  return useApp().fileWorkflows.state.value.clearURLParams
}
export const useState = () => {
  useSignals()
  return useApp().fileWorkflows.snapshot.value
}
