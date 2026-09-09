import { isPathNotFoundError } from '@src/lib/desktop'
import fsZds from '@src/lib/fs-zds'
import { normalizeFilesystemPathForComparison } from '@src/lib/paths'

export interface ModelingStateMatcher {
  matches: (...args: any[]) => boolean
}

export type OpenedProjectPresence =
  | { type: 'present' }
  | { type: 'missing' }
  | { type: 'error'; error: unknown }

export async function checkOpenedProjectPresence({
  projectPath,
  projects,
}: {
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
    await fsZds.stat(projectPath)
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
