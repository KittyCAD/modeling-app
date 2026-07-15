import fsZds from '@src/lib/fs-zds'

const PROJECT_FILESYSTEM_MUTATION_LOCK_NAME = 'zds:project-filesystem-mutation'

export class ProjectFilesystemMutationBusyError extends Error {
  constructor() {
    super('Project files are busy with another operation')
    this.name = 'ProjectFilesystemMutationBusyError'
  }
}

async function runWithNamedWebLock<T>(
  lockName: string,
  operation: () => Promise<T>,
  options: { ifAvailable?: boolean; mode?: LockMode } = {}
): Promise<T> {
  const lockManager =
    typeof navigator !== 'undefined' ? navigator.locks : undefined
  if (!lockManager) {
    return operation()
  }

  let lockAcquired = false
  let requestReachedCallback = false
  try {
    const callback = async (lock: Lock | null) => {
      requestReachedCallback = true
      if (!lock) {
        return Promise.reject(new ProjectFilesystemMutationBusyError())
      }
      lockAcquired = true
      return operation()
    }
    if (options.ifAvailable || options.mode) {
      return await lockManager.request(
        lockName,
        {
          ...(options.ifAvailable ? { ifAvailable: true } : {}),
          ...(options.mode ? { mode: options.mode } : {}),
        },
        callback
      )
    }
    return await lockManager.request(lockName, callback)
  } catch (error) {
    if (lockAcquired || requestReachedCallback) {
      return Promise.reject(error)
    }
    return operation()
  }
}

export function getProjectDirectoryNamespaceLockName(
  projectDirectoryPath: string
) {
  return `zds:project-directory-namespace:${fsZds
    .resolve(projectDirectoryPath)
    .replaceAll('\\', '/')}`
}

/**
 * Serialize project-root name allocation and mutation across cooperating
 * renderers. The filesystem's exclusive create/reservation primitives remain
 * the final cross-process authority; this lease closes readdir-then-create
 * races between in-app workflows.
 */
export async function runWithProjectDirectoryNamespaceLock<T>(
  projectDirectoryPath: string,
  operation: () => Promise<T>
): Promise<T> {
  return runWithNamedWebLock(
    getProjectDirectoryNamespaceLockName(projectDirectoryPath),
    operation
  )
}

/** Excludes stale editor/file-tree writes while a duplicate is published. */
export async function runWithProjectFilesystemMutationLock<T>(
  operation: () => Promise<T>,
  options: {
    ifAvailable?: boolean
    mode?: 'shared' | 'exclusive'
  } = {}
): Promise<T> {
  return runWithNamedWebLock(
    PROJECT_FILESYSTEM_MUTATION_LOCK_NAME,
    operation,
    options
  )
}
