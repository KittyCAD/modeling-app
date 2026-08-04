import { reportRejection } from '@src/lib/trap'

const PROJECT_DIRECTORY_LOCK_PREFIX = 'zds-project-directory:'

function projectDirectoryLockName(projectPath: string) {
  const normalizedPath = projectPath
    .trim()
    .replaceAll('\\', '/')
    .replace(/\/+$/g, '')
  return `${PROJECT_DIRECTORY_LOCK_PREFIX}${normalizedPath}`
}

function projectDirectoryLockManager() {
  return globalThis.navigator?.locks
}

/**
 * Hold a shared lock for as long as an editor has the project open. Web Locks
 * are shared across same-origin windows and tabs, and are released if their
 * renderer exits unexpectedly.
 */
export function holdOpenProjectDirectoryLock(projectPath: string) {
  const lockManager = projectDirectoryLockManager()
  if (!lockManager) {
    return () => undefined
  }

  let released = false
  let releaseLock: () => void = () => undefined
  const releasePromise = new Promise<void>((resolve) => {
    releaseLock = resolve
  })

  void lockManager
    .request(
      projectDirectoryLockName(projectPath),
      { mode: 'shared' },
      async () => {
        if (!released) {
          await releasePromise
        }
      }
    )
    .catch(reportRejection)

  return () => {
    released = true
    releaseLock()
  }
}

/**
 * Run a directory mutation only when no editor window or tab has the project
 * open. `undefined` means another context currently owns a shared lock.
 */
export function withProjectDirectoryWriteLock<T>(
  projectPath: string,
  operation: () => Promise<T>
): Promise<T | undefined> {
  const lockManager = projectDirectoryLockManager()
  if (!lockManager) {
    return operation()
  }

  return lockManager.request(
    projectDirectoryLockName(projectPath),
    { ifAvailable: true, mode: 'exclusive' },
    (lock) => (lock ? operation() : undefined)
  )
}
