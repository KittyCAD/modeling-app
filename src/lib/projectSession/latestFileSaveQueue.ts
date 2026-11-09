/** Serialize writes per file, retaining only the newest snapshot waiting to save. */
export function createLatestFileSaveQueue<T extends { requestedPath: string }>(
  write: (request: T) => Promise<void>
) {
  interface PendingSave {
    next: T | undefined
    finished: Promise<void>
  }
  const pending = new Map<string, PendingSave>()
  return {
    has: (path: string) => pending.has(path),
    settled: () =>
      Promise.allSettled([...pending.values()].map((s) => s.finished)),
    save: (request: T): Promise<void> => {
      const path = request.requestedPath
      const previous = pending.get(path)
      if (previous) {
        previous.next = request
        return previous.finished
      }
      const completion = Promise.withResolvers<undefined>()
      const entry: PendingSave = { next: request, finished: completion.promise }
      pending.set(path, entry)
      const drain = async () => {
        let failure: { error: unknown } | undefined
        try {
          while (entry.next) {
            const next = entry.next
            entry.next = undefined
            try {
              await write(next)
              failure = undefined
            } catch (error) {
              failure = { error }
            }
          }
        } finally {
          pending.delete(path)
        }
        if (failure) return Promise.reject(failure.error)
      }
      void drain().then(() => completion.resolve(undefined), completion.reject)
      return completion.promise
    },
  }
}
