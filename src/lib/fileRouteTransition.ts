import {
  ASK_TO_OPEN_QUERY_PARAM,
  EXECUTE_AST_INTERRUPT_ERROR_MESSAGE,
  PROJECT_ID_QUERY_PARAM,
} from '@src/lib/constants'
import makeUrlPathRelative from '@src/lib/makeUrlPathRelative'
import {
  PATHS,
  getProjectDirectoryFromKCLFilePath,
  webSafePathSplit,
} from '@src/lib/paths'

type FileRouteTransitionKclManager = {
  engineCommandManager: {
    rejectAllModelingCommands: (rejectionMessage: string) => void
  }
  isExecuting: boolean
  switchedFiles: boolean
}

export type FileRouteTransitionLsp = {
  onFileClose: (filePath: string | null, projectPath: string | null) => void
  onFileOpen: (filePath: string | null, projectPath: string | null) => void
}

export type FileRouteInfo = {
  filePathWithExtension: string | null
  projectDirectory: string | null
}

export function getFileRouteInfo({
  pathname,
  projectDirectoryPath,
}: {
  pathname: string
  projectDirectoryPath: string
}): FileRouteInfo {
  const [empty, file, encodedURI] = webSafePathSplit(pathname)
  if (empty !== '' || file !== makeUrlPathRelative(PATHS.FILE) || !encodedURI) {
    return {
      filePathWithExtension: null,
      projectDirectory: null,
    }
  }

  const filePathWithExtension = decodeURIComponent(encodedURI)
  return {
    filePathWithExtension,
    projectDirectory: getProjectDirectoryFromKCLFilePath(
      filePathWithExtension,
      projectDirectoryPath
    ),
  }
}

export function applyFileRouteTransitionEffects({
  currentFilePathWithExtension,
  currentProjectDirectory,
  requestedFilePathWithExtension,
  requestedProjectDirectory,
  kclManager,
  lsp,
}: {
  currentFilePathWithExtension: string | null
  currentProjectDirectory: string | null
  requestedFilePathWithExtension: string | null
  requestedProjectDirectory: string | null
  kclManager: FileRouteTransitionKclManager
  lsp: FileRouteTransitionLsp
}) {
  lsp.onFileClose(currentFilePathWithExtension, currentProjectDirectory)
  lsp.onFileOpen(requestedFilePathWithExtension, requestedProjectDirectory)

  kclManager.engineCommandManager.rejectAllModelingCommands(
    EXECUTE_AST_INTERRUPT_ERROR_MESSAGE
  )

  if (
    currentFilePathWithExtension &&
    requestedFilePathWithExtension &&
    currentFilePathWithExtension !== requestedFilePathWithExtension
  ) {
    kclManager.switchedFiles = true
  }

  kclManager.isExecuting = false
}

export function transitionToFileRoute({
  requestedPath,
  requestedFilePathWithExtension,
  requestedProjectDirectory,
  currentPathname,
  projectDirectoryPath,
  kclManager,
  lsp,
  navigate,
  locationHref = globalThis.location.href,
  clearProjectIdQueryParam = false,
}: {
  requestedPath: string
  requestedFilePathWithExtension: string | null
  requestedProjectDirectory: string | null
  currentPathname: string
  projectDirectoryPath: string
  kclManager: FileRouteTransitionKclManager
  lsp: FileRouteTransitionLsp
  navigate: (path: string) => void
  locationHref?: string
  clearProjectIdQueryParam?: boolean
}) {
  const currentRoute = getFileRouteInfo({
    pathname: currentPathname,
    projectDirectoryPath,
  })

  applyFileRouteTransitionEffects({
    currentFilePathWithExtension: currentRoute.filePathWithExtension,
    currentProjectDirectory: currentRoute.projectDirectory,
    requestedFilePathWithExtension,
    requestedProjectDirectory,
    kclManager,
    lsp,
  })

  const url = new URL(locationHref)
  url.searchParams.delete(ASK_TO_OPEN_QUERY_PARAM)
  if (clearProjectIdQueryParam) {
    url.searchParams.delete(PROJECT_ID_QUERY_PARAM)
  }
  const search = url.searchParams.toString()
  navigate(requestedPath + (search ? `?${search}` : ''))
}
