const pendingUpdates = new Map<string, Promise<void>>()

/** Keep settings and conversation read-modify-write operations from losing each other's changes. */
export function withProjectTomlLock<T>(
  path: string,
  operation: () => Promise<T>
): Promise<T> {
  const result = (pendingUpdates.get(path) ?? Promise.resolve()).then(operation)
  const completion = result.then(
    () => undefined,
    () => undefined
  )
  pendingUpdates.set(path, completion)
  void completion.then(() => {
    if (pendingUpdates.get(path) === completion) {
      pendingUpdates.delete(path)
    }
  })
  return result
}
