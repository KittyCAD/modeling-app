import { isPathNotFoundError } from '@src/lib/desktop'
import { normalizeFilesystemPathForComparison } from '@src/lib/paths'
import type { FileOperationsRegistryService } from '@src/registry/contracts/fileOperations'

export interface ModelingStateMatcher {
  matches: (...args: any[]) => boolean
}

export type OpenedProjectPresence =
  | { type: 'present' }
  | { type: 'missing' }
  | { type: 'error'; error: unknown }

export async function checkOpenedProjectPresence({
  fileOperations,
  projectPath,
  projects,
}: {
  fileOperations: Pick<FileOperationsRegistryService, 'stat'>
  projectPath: string
  projects: readonly { path: string }[]
}): Promise<OpenedProjectPresence> {
  const openedProjectPath = normalizeFilesystemPathForComparison(projectPath)
  if (
    projects.some(
      (candidate) =>
        normalizeFilesystemPathForComparison(candidate.path) ===
        openedProjectPath
    )
  ) {
    return { type: 'present' }
  }

  try {
    await fileOperations.stat(projectPath)
    return { type: 'present' }
  } catch (error) {
    if (isPathNotFoundError(error)) {
      return { type: 'missing' }
    }

    return { type: 'error', error }
  }
}

export type ZookeeperProjectReloadBehavior =
  | 'exit-sketch-solve'
  | 'execute-without-camera-reset'
  | 'execute-and-reset-camera'

export function getZookeeperProjectReloadBehavior(
  modelingState?: ModelingStateMatcher | null
): ZookeeperProjectReloadBehavior {
  if (modelingState?.matches('sketchSolveMode')) {
    return 'exit-sketch-solve'
  }

  if (modelingState?.matches('Sketch')) {
    return 'execute-without-camera-reset'
  }

  return 'execute-and-reset-camera'
}
