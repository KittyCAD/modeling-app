const pendingUpdates = new Map<string, Promise<unknown>>()

// Keep the complete read/change/save together for each project's TOML.
export function updateProjectToml<T>(
  projectTomlPath: string,
  update: () => Promise<T>
): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    return navigator.locks.request(
      `zds-project-toml:${projectTomlPath}`,
      update
    )
  }

  // Single-process backings also need sequencing when Web Locks are absent.
  const pending = (pendingUpdates.get(projectTomlPath) ?? Promise.resolve())
    .catch(() => undefined)
    .then(update)
  pendingUpdates.set(projectTomlPath, pending)
  return pending.finally(() => {
    if (pendingUpdates.get(projectTomlPath) === pending) {
      pendingUpdates.delete(projectTomlPath)
    }
  })
}
